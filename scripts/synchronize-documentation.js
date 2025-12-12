import {KNOWN_LANGUAGES, readAndFixLanguageImplementations} from "./language-implementations.js";
import fs from "node:fs";
import path from "node:path";
import {readSourceTypesByType} from "./source-schema.js";

/**
 * DocUpdater - Updates markdown files by replacing content between marker comments
 */
class DocUpdater {
    constructor(markerPrefix = "GENERATED", source = "opentelemetry-configuration") {
        this.markerPrefix = markerPrefix;
        this.source = source;
    }

    /**
     * Get the begin and end marker strings for a given marker ID
     */
    getMarkerPattern(markerId) {
        const begin = `<!-- BEGIN ${this.markerPrefix}: ${markerId} SOURCE: ${this.source} -->`;
        const end = `<!-- END ${this.markerPrefix}: ${markerId} SOURCE: ${this.source} -->`;
        return { begin, end };
    }

    /**
     * Update a section of content between markers
     * Returns { content: updatedContent, wasUpdated: boolean }
     */
    updateSection(content, markerId, newContent) {
        const { begin, end } = this.getMarkerPattern(markerId);

        // Build regex pattern that matches both with and without SOURCE for backward compatibility
        const beginPattern = `<!-- BEGIN ${this.markerPrefix}: ${markerId}(?:\\s+SOURCE:\\s+[\\w-]+)? -->`;
        const endPattern = `<!-- END ${this.markerPrefix}: ${markerId}(?:\\s+SOURCE:\\s+[\\w-]+)? -->`;

        const pattern = new RegExp(
            beginPattern + '[\\s\\S]*?' + endPattern,
            'g'
        );

        if (!pattern.test(content)) {
            return { content, wasUpdated: false };
        }

        const replacement = `${begin}\n${newContent}\n${end}`;
        const updatedContent = content.replace(pattern, replacement);

        return { content: updatedContent, wasUpdated: true };
    }

    /**
     * Update a file by replacing content between markers
     * Returns true if update was successful, false if markers not found
     */
    updateFile(filePath, markerId, newContent) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const originalContent = fs.readFileSync(filePath, 'utf-8');
        const { content: updatedContent, wasUpdated } = this.updateSection(
            originalContent,
            markerId,
            newContent
        );

        if (!wasUpdated) {
            return false;
        }

        fs.writeFileSync(filePath, updatedContent, 'utf-8');
        return true;
    }
}

/**
 * Generate language implementation status content
 */
function generateLanguageImplementationStatus() {
    const sourceTypesByType = readSourceTypesByType();
    const sourceTypes = Object.values(sourceTypesByType);

    const { messages, languageImplementations } = readAndFixLanguageImplementations();
    if (messages.length > 0) {
        throw new Error("Language implementations have problems. Please run fix-language-implementations and try again.");
    }

    const output = [];

    KNOWN_LANGUAGES.forEach(language => {
        output.push(`### ${language}\n\n`);

        const languageImplementation = languageImplementations.find(item => item.language === language);
        if (!languageImplementation) {
            throw new Error(`Meta schema LanguageImplementation not found for language ${language}.`);
        }

        output.push(`Latest supported file format: \`${languageImplementation.latestSupportedFileFormat}\`\n\n`);

        output.push(`| Type | Status | Notes | Support Status Details |\n`);
        output.push(`|---|---|---|---|\n`);

        languageImplementation.typeSupportStatuses.forEach(typeSupportStatus => {
            const sourceSchemaType = sourceTypes.find(item => item.type === typeSupportStatus.type);
            if (!sourceSchemaType) {
                throw new Error(`SourceSchemaType not found for type ${typeSupportStatus.type}.`);
            }

            let formattedNotes = typeSupportStatus.notes || "";

            const supportStatusDetails = [];

            if (!sourceSchemaType.isEnumType()) {
                sourceSchemaType.sortedProperties().forEach(sourceSchemaProperty => {
                    const propertyOverride = typeSupportStatus.propertyOverrides.find(
                        propertyOverride => propertyOverride.property === sourceSchemaProperty.property
                    );
                    const status = propertyOverride ? propertyOverride.status : typeSupportStatus.status;
                    supportStatusDetails.push(`* \`${sourceSchemaProperty.property}\`: ${status}<br>`);
                });
            } else {
                sourceSchemaType.sortedEnumValues().forEach(enumValue => {
                    const enumValueOverride = typeSupportStatus.enumOverrides.find(
                        enumOverride => enumOverride.enumValue === enumValue
                    );
                    const status = enumValueOverride ? enumValueOverride.status : typeSupportStatus.status;
                    supportStatusDetails.push(`* \`${enumValue}\`: ${status}<br>`);
                });
            }

            // Fix links to point to schema-docs.md in the configuration repo
            const typeLink = `[\`${typeSupportStatus.type}\`](https://github.com/open-telemetry/opentelemetry-configuration/blob/main/schema-docs.md#${typeSupportStatus.type.toLowerCase()})`;

            output.push(`| ${typeLink} | ${typeSupportStatus.status} | ${formattedNotes} | ${supportStatusDetails.join('')} |\n`);
        });
        output.push(`\n`);
    });

    return output.join('');
}

/**
 * Main function to synchronize documentation
 */
function main() {
    const args = process.argv.slice(2);

    let docsRepo = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--docs-repo' && i + 1 < args.length) {
            docsRepo = args[i + 1];
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: node synchronize-documentation.js --docs-repo <path>

Options:
  --docs-repo <path>   Path to the opentelemetry.io repository (required)
  --help, -h           Show this help message
            `);
            process.exit(0);
        }
    }

    if (!docsRepo) {
        console.error('Error: --docs-repo argument is required');
        console.error('Usage: node synchronize-documentation.js --docs-repo <path>');
        process.exit(1);
    }

    docsRepo = path.resolve(docsRepo);

    if (!fs.existsSync(docsRepo)) {
        console.error(`Error: Documentation repository not found at: ${docsRepo}`);
        process.exit(1);
    }

    console.log(`Synchronizing documentation to: ${docsRepo}`);
    console.log('');

    const updater = new DocUpdater("GENERATED", "opentelemetry-configuration");

    console.log('Generating language implementation status...');
    const languageStatusContent = generateLanguageImplementationStatus();

    // Update the language implementation status page
    const languageStatusPath = path.join(
        docsRepo,
        'content/en/docs/languages/sdk-configuration/language-implementation-status.md'
    );

    console.log(`Updating: ${path.relative(docsRepo, languageStatusPath)}`);

    if (!fs.existsSync(languageStatusPath)) {
        console.error(`Error: File not found: ${languageStatusPath}`);
        process.exit(1);
    }

    const wasUpdated = updater.updateFile(
        languageStatusPath,
        'language-implementation-status',
        languageStatusContent
    );

    if (wasUpdated) {
        console.log('Language implementation status updated successfully');
    } else {
        console.log('Failed to update language implementation status (markers not found)');
        process.exit(1);
    }

    console.log('');
    console.log('Documentation synchronization complete!');
}

// Run main function if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { DocUpdater, generateLanguageImplementationStatus };