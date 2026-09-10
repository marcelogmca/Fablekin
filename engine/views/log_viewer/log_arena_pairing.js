(function exposeLogArenaPairing(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.LogArenaPairing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPairingHelpers() {
    const normalizeTopic = title => String(title || '')
        .replace(/\s*\[.*?\]/g, '')
        .replace(/ - (Request|Response|Error)$/, '')
        .trim();

    function buildInvocations(data, topicOrTitle, {
        exactRequestTitle = false,
        projectName = '',
        filename = '',
        getMetrics = () => null
    } = {}) {
        if (!data || typeof data !== 'object' || !topicOrTitle) return [];
        const requestTitles = exactRequestTitle
            ? [topicOrTitle]
            : Object.keys(data).filter(title => title.endsWith(' - Request') && normalizeTopic(title) === topicOrTitle);

        return requestTitles.flatMap(requestTitle => {
            if (!Array.isArray(data[requestTitle])) return [];
            const baseTitle = requestTitle.replace(/ - Request$/, '').trim();
            const requests = data[requestTitle].filter(entry => entry && !entry.other)
                .slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const terminals = [
                ...(Array.isArray(data[`${baseTitle} - Response`]) ? data[`${baseTitle} - Response`].map(entry => ({ entry, status: 'response' })) : []),
                ...(Array.isArray(data[`${baseTitle} - Error`]) ? data[`${baseTitle} - Error`].map(entry => ({ entry, status: 'error' })) : [])
            ].filter(item => item.entry && !item.entry.other)
                .sort((a, b) => new Date(a.entry.timestamp) - new Date(b.entry.timestamp));
            const used = new Set();

            return requests.map(request => {
                const requestTime = new Date(request.timestamp).getTime();
                const terminalIndex = terminals.findIndex((item, index) =>
                    !used.has(index) && new Date(item.entry.timestamp).getTime() >= requestTime);
                const terminal = terminalIndex >= 0 ? terminals[terminalIndex] : null;
                if (terminalIndex >= 0) used.add(terminalIndex);
                return {
                    requestTitle,
                    projectName,
                    filename,
                    request,
                    response: terminal?.status === 'response' ? terminal.entry : null,
                    error: terminal?.status === 'error' ? terminal.entry : null,
                    metrics: terminal ? getMetrics(request, terminal.entry) : null,
                    pluginId: request.payload?.diagnostics?.pluginId || ''
                };
            });
        }).sort((a, b) => new Date(a.request.timestamp) - new Date(b.request.timestamp));
    }

    return { normalizeTopic, buildInvocations };
});
