import {KNOWN_LANGUAGES, readAndFixLanguageImplementations} from "./language-implementations.js";
import fs from "node:fs";
import path from "node:path";
import {readSourceTypesByType} from "./source-schema.js";
import {isExperimentalType, isExperimentalProperty} from "./util.js";

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
                    supportStatusDetails.push(`• \`${sourceSchemaProperty.property}\`: ${status}<br>`);
                });
            } else {
                sourceSchemaType.sortedEnumValues().forEach(enumValue => {
                    const enumValueOverride = typeSupportStatus.enumOverrides.find(
                        enumOverride => enumOverride.enumValue === enumValue
                    );
                    const status = enumValueOverride ? enumValueOverride.status : typeSupportStatus.status;
                    supportStatusDetails.push(`• \`${enumValue}\`: ${status}<br>`);
                });
            }

            const typeLink = `[\`${typeSupportStatus.type}\`](../types#${typeSupportStatus.type.toLowerCase()})`;

            output.push(`| ${typeLink} | ${typeSupportStatus.status} | ${formattedNotes} | ${supportStatusDetails.join('')} |\n`);
        });
        output.push(`\n`);
    });

    return output.join('').trimEnd();
}

/**
 * Generate types documentation content
 */
function generateTypesDocumentation() {
    const sourceTypesByType = readSourceTypesByType();
    const sourceTypes = Object.values(sourceTypesByType);

    const output = [];

    // Separate types into stable and experimental
    const types = [];
    const experimentalTypes = [];
    sourceTypes.sort((a, b) => a.type.localeCompare(b.type));
    sourceTypes.forEach(sourceSchemaType => {
        if (isExperimentalType(sourceSchemaType.type)) {
            experimentalTypes.push(sourceSchemaType);
        } else {
            types.push(sourceSchemaType);
        }
    });

    const formatPropertyType = (sourceProperty) => {
        const types = [];
        if (sourceProperty.isSeq) {
            types.push('`array` of ');
        }
        let prefix = '';
        let suffix = '';
        if (sourceProperty.types.length > 1) {
            types.push('one of:<br>');
            prefix = '• ';
            suffix = '<br>';
        }
        sourceProperty.types.forEach(type => {
            let resolvedType = sourceTypesByType[type];
            types.push(prefix);
            types.push(resolvedType ? `[\`${resolvedType.type}\`](#${resolvedType.type.toLowerCase()})` : `\`${type}\``);
            types.push(suffix);
        });
        return types.join('');
    };

    const formatConstraints = (schema) => {
        const constraints = [];
        const constraintPropertyNames = [
            'minLength', 'maxLength', 'pattern', 'format',
            'multipleOf', 'minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum',
            'patternProperties', 'additionalProperties', 'propertyNames',
            'minProperties', 'maxProperties', 'required',
            'contains', 'minContains', 'maxContains', 'uniqueItems',
            'const', 'minItems', 'maxItems'
        ];

        constraintPropertyNames.forEach(propertyName => {
            const property = schema[propertyName];
            if (property !== undefined && property !== null) {
                constraints.push(`• \`${propertyName}\`: \`${JSON.stringify(property)}\`<br>`);
            }
        });

        return constraints.join('');
    };

    const writeType = (sourceSchemaType) => {
        const type = sourceSchemaType.type;
        const required = sourceSchemaType.schema['required'];
        const description = sourceSchemaType.schema['description'];

        output.push(`### ${type} {#${type.toLowerCase()}}\n\n`);

        if (isExperimentalType(type)) {
            output.push('> **Warning:** This type is experimental and subject to breaking changes.\n\n');
        }

        if (sourceSchemaType.schema.isSdkExtensionPlugin) {
            output.push(`\`${type}\` is an SDK extension plugin point.\n\n`);
        }

        if (description) {
            output.push(`${description}\n\n`);
        }

        if (sourceSchemaType.isEnumType()) {
            output.push("**This is an enum type.**\n\n");
            output.push(`| Value | Description |\n`);
            output.push(`|---|---|\n`);
            sourceSchemaType.sortedEnumValues().forEach(enumValue => {
                const description = sourceSchemaType.schema['enumDescriptions'][enumValue];
                const formattedDescription = description.split("\n").join("<br>");
                output.push(`| \`${enumValue}\` | ${formattedDescription} |\n`);
            });
            output.push('\n');
        } else {
            const properties = sourceSchemaType.sortedProperties();
            if (properties.length === 0) {
                output.push("**No properties.**\n\n");
            } else {
                output.push(`| Property | Type | Required? | Default Behavior | Description |\n`);
                output.push("|---|---|---|---|---|\n");
                properties.forEach(sourceSchemaProperty => {
                    let formattedProperty = `\`${sourceSchemaProperty.property}\``;
                    if (isExperimentalProperty(sourceSchemaProperty.property)) {
                        formattedProperty += '<br>**⚠ Experimental**';
                    }
                    const formattedPropertyType = formatPropertyType(sourceSchemaProperty);
                    const isRequired = required !== undefined && required.includes(sourceSchemaProperty.property);
                    const formattedDefaultBehavior = sourceSchemaProperty.formatDefaultAndNullBehavior();
                    const formattedDescription = sourceSchemaProperty.schema.description.split("\n").join("<br>");

                    output.push(`| ${formattedProperty} | ${formattedPropertyType} | \`${isRequired}\` | ${formattedDefaultBehavior} | ${formattedDescription} |\n`);
                });
                output.push('\n');
            }
        }

        const formattedConstraints = formatConstraints(sourceSchemaType.schema);
        if (formattedConstraints.length > 0) {
            output.push('**Constraints:**\n\n');
            output.push(formattedConstraints);
            output.push('\n');
        }
    };

    output.push("# Configuration Types\n\n");
    output.push("This page documents all configuration types for the OpenTelemetry SDK declarative configuration.\n\n");
    output.push("## Stable Types\n\n");
    types.forEach(writeType);

    if (experimentalTypes.length > 0) {
        output.push("## Experimental Types\n\n");
        output.push("> **Warning:** Experimental types are subject to breaking changes.\n\n");
        experimentalTypes.forEach(writeType);
    }

    return output.join('').trimEnd();
}

/**
 * Main function to synchronize documentation
 */
function main() {
    const args = process.argv.slice(2);

    let docsRepo = null;
    let page = 'language-implementation'; // default page

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--docs-repo' && i + 1 < args.length) {
            docsRepo = args[i + 1];
            i++;
        } else if (args[i] === '--page' && i + 1 < args.length) {
            page = args[i + 1];
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: node synchronize-documentation.js --docs-repo <path> [--page <name>]

Options:
  --docs-repo <path>   Path to the opentelemetry.io repository (required)
  --page <name>        Page to synchronize: language-implementation (default) or types
  --help, -h           Show this help message
            `);
            process.exit(0);
        }
    }

    if (!docsRepo) {
        console.error('Error: --docs-repo argument is required');
        console.error('Usage: node synchronize-documentation.js --docs-repo <path> [--page <name>]');
        process.exit(1);
    }

    if (page !== 'language-implementation' && page !== 'types') {
        console.error(`Error: Invalid page "${page}". Must be "language-implementation" or "types"`);
        process.exit(1);
    }

    docsRepo = path.resolve(docsRepo);

    if (!fs.existsSync(docsRepo)) {
        console.error(`Error: Documentation repository not found at: ${docsRepo}`);
        process.exit(1);
    }

    console.log(`Synchronizing documentation to: ${docsRepo}`);
    console.log(`Page: ${page}`);
    console.log('');

    const updater = new DocUpdater("GENERATED", "opentelemetry-configuration");

    if (page === 'language-implementation') {
        console.log('Generating language implementation status...');
        const languageStatusContent = generateLanguageImplementationStatus();

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
    } else if (page === 'types') {
        console.log('Generating types documentation...');
        const typesContent = generateTypesDocumentation();

        const typesPath = path.join(
            docsRepo,
            'content/en/docs/languages/sdk-configuration/types.md'
        );

        console.log(`Updating: ${path.relative(docsRepo, typesPath)}`);

        if (!fs.existsSync(typesPath)) {
            console.error(`Error: File not found: ${typesPath}`);
            process.exit(1);
        }

        const wasUpdated = updater.updateFile(
            typesPath,
            'types',
            typesContent
        );

        if (wasUpdated) {
            console.log('Types documentation updated successfully');
        } else {
            console.log('Failed to update types documentation (markers not found)');
            process.exit(1);
        }
    }

    console.log('');
    console.log('Documentation synchronization complete!');
}

// Run main function if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { DocUpdater, generateLanguageImplementationStatus, generateTypesDocumentation };