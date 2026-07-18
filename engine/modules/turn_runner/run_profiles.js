const RUN_PROFILES = Object.freeze({
    mainline: Object.freeze({
        id: 'mainline',
        mode: 'mainline',
        sceneMode: 'mainline',
        persistenceMode: 'canonical',
        canonicalWrites: true,
        awaitBackgroundTasks: false,
        hookPolicy: 'all'
    }),
    interlude_story: Object.freeze({
        id: 'interlude_story',
        mode: 'interlude',
        sceneMode: 'interlude',
        persistenceMode: 'virtual',
        canonicalWrites: false,
        awaitBackgroundTasks: true,
        hookPolicy: 'opt-in',
        storyRelevantDefault: true
    }),
    interlude_sandbox: Object.freeze({
        id: 'interlude_sandbox',
        mode: 'interlude',
        sceneMode: 'interlude',
        persistenceMode: 'virtual',
        canonicalWrites: false,
        awaitBackgroundTasks: true,
        hookPolicy: 'opt-in',
        storyRelevantDefault: false
    })
});

function getRunProfile(profileId) {
    const profile = RUN_PROFILES[profileId];
    if (!profile) {
        throw new Error(`Unknown run profile: ${profileId}`);
    }
    return profile;
}

function resolveRunProfile({ mode = 'mainline', profileId = null, isStoryRelevant = false } = {}) {
    if (profileId) return getRunProfile(profileId);
    if (mode === 'interlude') {
        return isStoryRelevant === true
            ? RUN_PROFILES.interlude_story
            : RUN_PROFILES.interlude_sandbox;
    }
    return RUN_PROFILES.mainline;
}

module.exports = {
    RUN_PROFILES,
    getRunProfile,
    resolveRunProfile
};
