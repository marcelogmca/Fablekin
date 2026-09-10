/**
 * Character Sheets - Identity Library
 * Handles name resolution, alias mapping, and record deduping.
 */

async function resolveName(tools, name) {
    if (!name || typeof name !== 'string') return name;
    const lowerName = name.toLowerCase().trim();
    tools.logger.runtime(`identity: resolveName for '${name}'`);

    try {
        const localSheets = tools.turnContext
            ? tools.pluginState.forPlugin('character_sheets').fromContext(tools.turnContext).turn().sheets
            : null;
        if (localSheets) {
            for (const s of localSheets) {
                if (s.name.toLowerCase() === lowerName) {
                    tools.logger.runtime(`resolveName: Match found in local sheets for ${s.name}`);
                    return s.name;
                }
                if (s.capsule?.aliases) {
                    const aliases = s.capsule.aliases.split(',').map(a => a.toLowerCase().trim());
                    if (aliases.includes(lowerName)) {
                        tools.logger.runtime(`resolveName: Alias match found in local sheets: ${name} -> ${s.name}`);
                        return s.name;
                    }
                }
            }
        }

        const bracketMatch = name.match(/\(([^)]+)\)$/);
        if (bracketMatch) {
            const inner = bracketMatch[1].trim();
            tools.logger.runtime(`resolveName: Found bracketed name '${inner}' in '${name}'`);
            return await resolveName(tools, inner);
        }

        const projectRows = await tools.db.project.query(
            "SELECT character_name FROM character_sheets WHERE LOWER(character_name) = ?",
            [lowerName]
        );
        if (projectRows.length > 0) {
            tools.logger.runtime(`resolveName: SQL Project match: ${name} -> ${projectRows[0].character_name}`);
            return projectRows[0].character_name;
        }

        const aliasRows = await tools.db.chat.query(
            "SELECT target FROM facts WHERE source = ? AND predicate = 'IS_ALIAS_OF' ORDER BY turn_number DESC LIMIT 1",
            [lowerName]
        );
        if (aliasRows.length > 0) {
            tools.logger.runtime(`resolveName: SQL Alias match: ${name} -> ${aliasRows[0].target}`);
            return aliasRows[0].target;
        }

        const reverseAliasRows = await tools.db.chat.query(
            "SELECT target FROM facts WHERE target = ? AND predicate = 'IS_ALIAS_OF' LIMIT 1",
            [lowerName]
        );
        if (reverseAliasRows.length > 0) {
            tools.logger.runtime(`resolveName: SQL Reverse Alias match: ${name} -> ${reverseAliasRows[0].target}`);
            return reverseAliasRows[0].target;
        }

        const factRows = await tools.db.chat.query(
            "SELECT source FROM facts WHERE source = ? AND predicate != 'IS_ALIAS_OF' LIMIT 1",
            [lowerName]
        );
        if (factRows.length > 0) {
            tools.logger.runtime(`resolveName: Fact source found for '${name}', returning as canonical`);
            return name;
        }

    } catch (e) {
        tools.logger.error('Identity', `Error resolving name '${name}': ${e.message}`);
    }
    return name;
}

async function dedupeAndMergeCharacters(tools, characters, existingNames = new Set()) {
    tools.logger.runtime(`identity: dedupeAndMergeCharacters for ${characters?.length || 0} characters`);
    const uniqueMap = new Map();

    for (const char of characters) {
        if (!char.name) continue;

        const resolvedName = await resolveName(tools, char.name);
        const lowerResolved = resolvedName.toLowerCase();

        if (existingNames.has(lowerResolved)) {
            tools.logger.runtime(`dedupeAndMergeCharacters: Skipping ${char.name}, already in existingNames`);
            continue;
        }

        const ignoredAliases = new Set(['none', 'n/a', 'na', 'unknown', 'null', '-']);
        const currentAliases = (char.aliases || "").split(',').map(a => a.toLowerCase().trim()).filter(a => a && !ignoredAliases.has(a));
        let merged = false;

        // Using iteration to allow for break
        for (const [existingLower, existingChar] of uniqueMap) {
            const existingAliases = (existingChar.aliases || "").split(',').map(a => a.toLowerCase().trim()).filter(a => a && !ignoredAliases.has(a));
            const shareAlias = currentAliases.some(a => existingAliases.includes(a));

            // Check for name collision or alias collision
            const isSameName = existingLower === lowerResolved;
            const isAliasMatch = existingAliases.includes(lowerResolved) || currentAliases.includes(existingLower) || shareAlias;

            if (isSameName || isAliasMatch) {
                tools.logger.runtime(`dedupeAndMergeCharacters: Merging ${char.name} into ${existingChar.name}`);
                // Merge Aliases
                const allAliases = new Set([...existingAliases, ...currentAliases]);
                // Remove the canonical names from aliases list if they ended up there
                allAliases.delete(existingChar.name.toLowerCase());
                allAliases.delete(char.name.toLowerCase());

                // Format aliases nicely (Capitalized)
                existingChar.aliases = Array.from(allAliases)
                    .map(a => a.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))
                    .join(', ');

                // Merge biography (take the longer one).
                const charBio = char.biography || "";
                const existingBio = existingChar.biography || "";

                if (charBio.length > existingBio.length) {
                    existingChar.biography = charBio;
                }

                // Merge other fields if missing in existing
                for (const key in char) {
                    if (key !== 'name' && key !== 'aliases' && key !== 'biography') {
                        if (!existingChar[key] && char[key]) {
                            existingChar[key] = char[key];
                        }
                    }
                }

                merged = true;
                break;
            }
        }

        if (!merged) {
            tools.logger.runtime(`dedupeAndMergeCharacters: Adding new entry for ${char.name}`);
            uniqueMap.set(lowerResolved, char);
        }
    }
    tools.logger.runtime(`dedupeAndMergeCharacters: Deduplication finished. Result: ${uniqueMap.size} characters`);
    return Array.from(uniqueMap.values());
}

module.exports = { resolveName, dedupeAndMergeCharacters };
