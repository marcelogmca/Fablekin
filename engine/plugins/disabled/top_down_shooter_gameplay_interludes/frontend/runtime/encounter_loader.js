(() => {
    function resolveEncounterEntry(encounterId = null) {
        const encounters = window.TDSEncounters || {};

        const requestedId = (typeof encounterId === 'string' && encounterId.trim())
            ? encounterId.trim()
            : null;
        const defaultId = (typeof encounters.defaultId === 'string' && encounters.defaultId.trim())
            ? encounters.defaultId.trim()
            : null;

        let raw = null;
        let resolvedId = null;
        if (requestedId && encounters[requestedId]) {
            raw = encounters[requestedId];
            resolvedId = requestedId;
        }
        if (!raw && defaultId && encounters[defaultId]) {
            raw = encounters[defaultId];
            resolvedId = defaultId;
        }
        return {
            raw,
            requestedId,
            defaultId,
            resolvedId,
            usedDefaultFallback: !!requestedId && !!defaultId && resolvedId === defaultId && requestedId !== defaultId
        };
    }

    function loadEncounterResult(encounterId = null, options = null) {
        const schema = window.TDSEncounterSchema;
        if (!schema || (typeof schema.validateEncounter !== 'function' && typeof schema.validateEncounterDefinition !== 'function')) {
            throw new Error('TDSEncounterSchema is unavailable.');
        }
        const entry = resolveEncounterEntry(encounterId);
        const raw = entry.raw;
        const result = (typeof schema.validateEncounterDefinition === 'function')
            ? schema.validateEncounterDefinition(raw, options || null)
            : schema.validateEncounter(raw);
        const payload = (result && typeof result === 'object')
            ? result
            : { ok: false, encounter: null, warnings: [], errors: ['Encounter schema validation returned no result.'] };
        return {
            ...payload,
            requestedId: entry.requestedId,
            defaultId: entry.defaultId,
            resolvedId: entry.resolvedId,
            usedDefaultFallback: entry.usedDefaultFallback
        };
    }

    function loadEncounterDefinitionResult(source = null, options = null) {
        const schema = window.TDSEncounterSchema;
        if (!schema || (typeof schema.validateEncounter !== 'function' && typeof schema.validateEncounterDefinition !== 'function')) {
            throw new Error('TDSEncounterSchema is unavailable.');
        }
        if (typeof schema.validateEncounterDefinition === 'function') {
            return schema.validateEncounterDefinition(source, options || null);
        }
        return schema.validateEncounter(source);
    }

    function loadEncounter(encounterId = null, options = null) {
        return loadEncounterResult(encounterId, options).encounter;
    }

    window.TDSEncounterLoader = {
        loadEncounter,
        loadEncounterResult,
        loadEncounterDefinitionResult
    };
})();
