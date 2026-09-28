const {
    CORE_COMPONENTS,
    buildPluginCatalogueEntries,
    getSlotGroup,
    normalizePluginKey,
    validateCatalog,
    validatePromptPieces
} = require('../../prompt/prompt_core_catalog.js');

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const displayName = key => key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

function buildChild(pluginId, key, value, parentId) {
    normalizePluginKey(key, 'child key');
    const text = typeof value === 'string' ? value : (isObject(value) && typeof value.text === 'string' ? value.text : '');
    if (typeof value !== 'string' && !isObject(value)) {
        throw new TypeError(`Prompt child '${key}' must be text or a nested child map.`);
    }
    const childrenSource = isObject(value)
        ? (value.children === undefined ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'text')) : value.children)
        : {};
    if (!isObject(childrenSource)) throw new TypeError(`Prompt child '${key}' children must be a map.`);
    const componentId = `${parentId}.${key}`;
    const children = Object.entries(childrenSource).map(([childKey, childValue]) => buildChild(pluginId, childKey, childValue, componentId));
    if (!text.trim() && children.length === 0) throw new Error(`Prompt child '${componentId}' has no text or children.`);
    return {
        definition: {
            key,
            label: displayName(key),
            description: `${displayName(key)} contributed by ${pluginId}.`,
            ...(children.length > 0 ? { children: children.map(child => child.definition) } : {})
        },
        occurrence: {
            kind: 'component', componentId, instanceKey: null, text,
            children: children.map(child => child.occurrence), owner: pluginId
        }
    };
}

function mergeChildren(existing = [], incoming = [], parentId) {
    const result = existing.map(child => structuredClone(child));
    for (const child of incoming) {
        const previous = result.find(item => item.key === child.key);
        if (!previous) {
            result.push(child);
            continue;
        }
        if (previous.label !== child.label || previous.description !== child.description) {
            throw new Error(`Prompt piece '${parentId}.${child.key}' changed its registered identity.`);
        }
        previous.children = mergeChildren(previous.children, child.children, `${parentId}.${child.key}`);
    }
    return result;
}

/**
 * Define a plugin-owned component where its data is supplied. Validation is
 * performed against a tentative catalogue before either the registry or the
 * TurnContext is changed. The returned commit is synchronous and may be
 * called only after addPromptOccurrence has accepted the occurrence.
 */
function preparePromptContribution(pluginManager, pluginId, input, options = {}) {
    if (!isObject(input)) throw new TypeError('tools.prompt.contribute expects an object with id, to and text/children.');
    const id = normalizePluginKey(input.id, 'id');
    if (typeof input.to !== 'string' || !/^(root|writer|director)\.[a-z_]+$/.test(input.to)) {
        throw new TypeError(`Prompt piece '${id}' requires a destination like 'root.simulation'.`);
    }
    const [target, slot] = input.to.split('.');
    getSlotGroup(target, slot);
    if (typeof input.text !== 'string' && input.text !== undefined) {
        throw new TypeError(`Prompt piece '${id}' text must be a string.`);
    }
    if (input.children !== undefined && !isObject(input.children)) {
        throw new TypeError(`Prompt piece '${id}' children must be a map.`);
    }
    const childData = Object.entries(input.children || {}).map(([key, value]) => buildChild(pluginId, key, value, `${pluginId}.${id}`));
    const text = input.text || '';
    if (!text.trim() && childData.length === 0) throw new Error(`Prompt piece '${id}' has no text or children.`);
    const registry = pluginManager?.promptRegistry;
    if (!(registry instanceof Map)) throw new Error('PluginManager prompt registry is unavailable.');
    const previousPieces = registry.get(pluginId);
    const existing = previousPieces?.[id];
    if (existing && (existing.target !== target || existing.slot !== slot)) {
        throw new Error(`Prompt piece '${pluginId}.${id}' cannot move from ${existing.target}.${existing.slot} to ${input.to}.`);
    }
    const label = input.label === undefined ? (existing?.label || displayName(id)) : input.label;
    const description = input.description === undefined
        ? (existing?.description || `${displayName(id)} contributed by ${pluginId}.`)
        : input.description;
    if (existing && (label !== existing.label || description !== existing.description)) {
        throw new Error(`Prompt piece '${pluginId}.${id}' changed its registered label or description.`);
    }
    const nextPieces = { ...(previousPieces || {}) };
    nextPieces[id] = {
        target, slot, label, description,
        children: mergeChildren(existing?.children, childData.map(child => child.definition), `${pluginId}.${id}`)
    };
    validatePromptPieces(pluginId, nextPieces);
    const tentative = new Map(registry);
    tentative.set(pluginId, nextPieces);
    validateCatalog(Object.assign(Object.create(null), CORE_COMPONENTS, buildPluginCatalogueEntries(tentative)));

    const occurrence = {
        kind: 'component', componentId: `${pluginId}.${id}`,
        instanceKey: typeof options.instanceKey === 'string' && options.instanceKey ? options.instanceKey : null,
        text, children: childData.map(child => child.occurrence), owner: pluginId,
        slotAnchor: input.to,
        separator: typeof options.separator === 'string' ? options.separator : '\n\n',
        directable: input.directable === true || options.directable === true,
        ...(input.directable === true || options.directable === true ? { directablePluginId: pluginId } : {})
    };
    return {
        target, slot, occurrence,
        commit() {
            const rollback = () => {
                if (previousPieces) registry.set(pluginId, previousPieces);
                else registry.delete(pluginId);
                pluginManager.rebuildPromptCatalogueSnapshot?.();
            };
            registry.set(pluginId, nextPieces);
            try {
                pluginManager.rebuildPromptCatalogueSnapshot?.();
            } catch (error) {
                rollback();
                throw error;
            }
            return { pieces: nextPieces, rollback };
        }
    };
}

module.exports = { preparePromptContribution };
