((root) => {
    const PROFILE = Object.freeze({
        id: 'tds_v1_core_bullet_hell',
        version: 1,
        strictTopLevelFields: Object.freeze([
            'schemaVersion',
            'id',
            'title',
            'seed',
            'budgets',
            'arena',
            'runtimeSettings',
            'player',
            'playerKit',
            'colors',
            'pressurePattern',
            'patterns',
            'objectives',
            'pickups',
            'emitters',
            'projectileTypes',
            'enemyTypes',
            'enemyArchetypes',
            'sequence',
            'resultRules'
        ]),
        disallowedTopLevelFields: Object.freeze([
            'renderPresets',
            'music',
            'statusEffects',
            'hazards',
            'objects'
        ]),
        disallowedSequenceFields: Object.freeze([
            'actionGroups',
            'initialFlags',
            'initialCounters'
        ]),
        patternTypes: Object.freeze([
            'spiral',
            'radial',
            'fan',
            'aimed',
            'line',
            'rain'
        ]),
        projectileModifierTypes: Object.freeze([
            'accelerate',
            'sine_wave',
            'home_to_player',
            'split_after_time'
        ]),
        enemyBehaviors: Object.freeze([
            'chase_player',
            'stationary_turret',
            'keep_distance',
            'charge_telegraphed',
            'boss_anchor'
        ]),
        objectiveTypes: Object.freeze([
            'survive_time',
            'defeat_count',
            'defeat_enemy_type',
            'defeat_boss'
        ]),
        pickupTypes: Object.freeze([
            'heal_orb',
            'cooldown_reset'
        ]),
        actionTypes: Object.freeze([
            'spawn_enemy',
            'transition_phase',
            'set_objective',
            'show_banner',
            'fire_pattern',
            'spawn_telegraph',
            'telegraph_then_fire',
            'clear_telegraphs',
            'spawn_pickup',
            'clear_pickups',
            'spawn_emitter',
            'clear_emitters',
            'activate_objective',
            'complete_objective',
            'fail_objective',
            'set_objective_progress',
            'win'
        ]),
        triggerTypes: Object.freeze([
            'all_enemies_defeated',
            'time_elapsed',
            'phase_elapsed',
            'enemy_defeated_count',
            'enemy_type_defeated_count',
            'boss_hp_below',
            'objective_completed',
            'objective_failed'
        ])
    });

    const api = Object.freeze({
        profile: PROFILE
    });

    if (root) root.TDSV1CapabilityProfile = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
