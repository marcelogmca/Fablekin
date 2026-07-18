(() => {
    function createEntityManager() {
        const entities = [];
        const bullets = [];
        let idCounter = 1;

        function nextId(prefix = 'entity') {
            const id = prefix + '_' + idCounter;
            idCounter += 1;
            return id;
        }

        function spawnBullet(sprite, state) {
            const collision = state?.collision && typeof state.collision === 'object' ? state.collision : {};
            const bullet = {
                id: state.id || nextId('bullet'),
                sprite,
                x: state.x,
                y: state.y,
                z: state.z,
                vx: state.vx,
                vy: state.vy,
                vz: state.vz,
                life: state.life,
                team: state.team || 'neutral',
                radius: Number(state.radius) || 8,
                damage: Math.max(0, Number(state.damage) || 1),
                projectileType: String(state.projectileType || ''),
                modifiers: Array.isArray(state?.modifiers) ? state.modifiers : [],
                render: state?.render && typeof state.render === 'object' ? { ...state.render } : null,
                collision: {
                    destroyOnHit: collision.destroyOnHit !== false,
                    pierce: Math.max(0, Number.parseInt(collision.pierce, 10) || 0),
                    canBeCleared: collision.canBeCleared !== false,
                    activeAfterSeconds: Math.max(0, Number(collision.activeAfterSeconds) || 0),
                    hitCooldownByTarget: Math.max(0, Number(collision.hitCooldownByTarget) || 0),
                    friendlyFire: collision.friendlyFire === true
                },
                ageMs: 0,
                remainingPierce: Math.max(0, Number.parseInt(collision.pierce, 10) || 0),
                hitTargetTs: Object.create(null),
                type: 'projectile'
            };
            bullets.push(bullet);
            entities.push(bullet);
            return bullet;
        }

        function forEachBullet(fn) {
            for (let i = bullets.length - 1; i >= 0; i -= 1) {
                fn(bullets[i], i);
            }
        }

        function removeBulletAt(index) {
            const [removed] = bullets.splice(index, 1);
            if (!removed) return;
            const entityIndex = entities.indexOf(removed);
            if (entityIndex >= 0) entities.splice(entityIndex, 1);
        }

        function clearBullets() {
            while (bullets.length > 0) {
                removeBulletAt(0);
            }
        }

        function createEntity(entity) {
            const value = {
                id: entity?.id || nextId(entity?.type || 'entity'),
                type: entity?.type || 'entity',
                team: entity?.team || 'neutral',
                alive: entity?.alive !== false,
                x: Number(entity?.x) || 0,
                y: Number(entity?.y) || 0,
                z: Number(entity?.z) || 0,
                vx: Number(entity?.vx) || 0,
                vy: Number(entity?.vy) || 0,
                vz: Number(entity?.vz) || 0,
                radius: Number(entity?.radius) || 8,
                hp: Number(entity?.hp) || null,
                maxHp: Number(entity?.maxHp) || null,
                data: entity?.data || {}
            };
            entities.push(value);
            return value;
        }

        function removeEntityById(id) {
            const idx = entities.findIndex((entity) => entity.id === id);
            if (idx < 0) return false;
            const [removed] = entities.splice(idx, 1);
            if (!removed) return false;
            const bulletIndex = bullets.indexOf(removed);
            if (bulletIndex >= 0) bullets.splice(bulletIndex, 1);
            return true;
        }

        function forEachEntity(fn) {
            for (let i = entities.length - 1; i >= 0; i -= 1) {
                fn(entities[i], i);
            }
        }

        function getEntitiesByType(type) {
            return entities.filter((entity) => entity.type === type);
        }

        function clearAll() {
            entities.splice(0, entities.length);
            bullets.splice(0, bullets.length);
        }

        return {
            spawnBullet,
            forEachBullet,
            removeBulletAt,
            clearBullets,
            createEntity,
            removeEntityById,
            forEachEntity,
            getEntitiesByType,
            clearAll
        };
    }

    window.TDSEntityManager = {
        create: createEntityManager
    };
})();
