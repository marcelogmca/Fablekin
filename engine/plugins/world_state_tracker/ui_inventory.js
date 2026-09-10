/* global context */
(function (context) {
    const { socket } = context;
    const pendingUseItems = new Map();
    const pendingDeleteItems = new Map();
    const USE_NOTICE_ID = 'world_state_tracker.inventory_use';
    const DELETE_NOTICE_ID = 'world_state_tracker.inventory_delete';

    const itemLabel = item => {
        const quantity = Number(item.quantity || 0);
        return quantity > 1 ? `${item.item} x${quantity}` : item.item;
    };

    const emitInventoryUseUpdated = () => {
        window.dispatchEvent(new CustomEvent('world-state-tracker:inventory-use-updated', {
            detail: { items: Array.from(pendingUseItems.values()) }
        }));
        window.dispatchEvent(new CustomEvent('world-state-tracker:inventory-intent-updated', {
            detail: {
                useItems: Array.from(pendingUseItems.values()),
                deleteItems: Array.from(pendingDeleteItems.values())
            }
        }));
    };

    const renderNotice = () => {
        const hud = window.FablekinVNHud;
        if (!hud?.setPinnedNotice) return;
        const useItems = Array.from(pendingUseItems.values());
        const deleteItems = Array.from(pendingDeleteItems.values());

        if (useItems.length === 0) {
            hud.removePinnedNotice?.(USE_NOTICE_ID);
        } else {
            hud.setPinnedNotice({
                id: USE_NOTICE_ID,
                owner: 'world_state_tracker',
                priority: 30,
                tone: 'inventory',
                kicker: 'Inventory intent waiting for Send',
                title: `Use ${useItems.map(itemLabel).join(', ')}`,
                detail: 'Added to Send. Click a selected inventory item again to unselect it.',
                dismissible: true,
                dismissLabel: 'Cancel',
                onDismiss: () => {
                    pendingUseItems.clear();
                    renderNotice();
                    emitInventoryUseUpdated();
                }
            });
        }

        if (deleteItems.length === 0) {
            hud.removePinnedNotice?.(DELETE_NOTICE_ID);
        } else {
            hud.setPinnedNotice({
                id: DELETE_NOTICE_ID,
                owner: 'world_state_tracker',
                priority: 31,
                tone: 'inventory',
                kicker: 'Inventory deletion waiting for Send',
                title: `Discard ${deleteItems.map(itemLabel).join(', ')}`,
                detail: 'Will be added to Send as a disposal intent. Click selected Delete again to unselect.',
                dismissible: true,
                dismissLabel: 'Cancel',
                onDismiss: () => {
                    pendingDeleteItems.clear();
                    renderNotice();
                    emitInventoryUseUpdated();
                }
            });
        }
    };

    const addUseItem = item => {
        const name = String(item?.item || '').trim();
        const quantity = Math.max(1, Math.round(Number(item?.quantity || 1)));
        if (!name) return;
        const key = name.toLowerCase();
        pendingDeleteItems.delete(key);
        pendingUseItems.set(key, { item: name, quantity });
        renderNotice();
        emitInventoryUseUpdated();
    };

    const removeUseItem = item => {
        const name = String(item?.item || item || '').trim();
        if (!name) return;
        pendingUseItems.delete(name.toLowerCase());
        renderNotice();
        emitInventoryUseUpdated();
    };

    const addDeleteItem = item => {
        const name = String(item?.item || '').trim();
        const quantity = Math.max(1, Math.round(Number(item?.quantity || 1)));
        if (!name) return;
        const key = name.toLowerCase();
        pendingUseItems.delete(key);
        pendingDeleteItems.set(key, { item: name, quantity });
        renderNotice();
        emitInventoryUseUpdated();
    };

    const removeDeleteItem = item => {
        const name = String(item?.item || item || '').trim();
        if (!name) return;
        pendingDeleteItems.delete(name.toLowerCase());
        renderNotice();
        emitInventoryUseUpdated();
    };

    const toggleUseItem = item => {
        const name = String(item?.item || '').trim();
        if (!name) return false;
        const key = name.toLowerCase();
        if (pendingUseItems.has(key)) {
            pendingUseItems.delete(key);
            renderNotice();
            emitInventoryUseUpdated();
            return false;
        }
        addUseItem(item);
        return true;
    };

    const toggleDeleteItem = item => {
        const name = String(item?.item || '').trim();
        if (!name) return false;
        const key = name.toLowerCase();
        if (pendingDeleteItems.has(key)) {
            pendingDeleteItems.delete(key);
            renderNotice();
            emitInventoryUseUpdated();
            return false;
        }
        addDeleteItem(item);
        return true;
    };

    const clearUseItems = () => {
        pendingUseItems.clear();
        window.FablekinVNHud?.removePinnedNotice?.(USE_NOTICE_ID);
        emitInventoryUseUpdated();
    };

    const clearDeleteItems = () => {
        pendingDeleteItems.clear();
        window.FablekinVNHud?.removePinnedNotice?.(DELETE_NOTICE_ID);
        emitInventoryUseUpdated();
    };

    const clearAllInventoryIntents = () => {
        pendingUseItems.clear();
        pendingDeleteItems.clear();
        window.FablekinVNHud?.removePinnedNotice?.(USE_NOTICE_ID);
        window.FablekinVNHud?.removePinnedNotice?.(DELETE_NOTICE_ID);
        emitInventoryUseUpdated();
    };

    window.WorldStateInventoryHud = {
        addUseItem,
        removeUseItem,
        toggleUseItem,
        addDeleteItem,
        removeDeleteItem,
        toggleDeleteItem,
        clearUseItems,
        clearDeleteItems,
        clearAllInventoryIntents,
        getPendingUseItems: () => Array.from(pendingUseItems.values()),
        getPendingDeleteItems: () => Array.from(pendingDeleteItems.values()),
        isUseItemPending: item => pendingUseItems.has(String(item?.item || item || '').trim().toLowerCase()),
        isDeleteItemPending: item => pendingDeleteItems.has(String(item?.item || item || '').trim().toLowerCase())
    };

    window.addEventListener('vn:before-user-input-submit', event => {
        const useItems = Array.from(pendingUseItems.values());
        const deleteItems = Array.from(pendingDeleteItems.values());
        if (useItems.length === 0 && deleteItems.length === 0) return;
        event.detail.inventoryIntent = {
            useItems,
            deleteItems,
            useText: useItems.length > 0
                ? `The player is deliberately trying to use the following carried item(s): ${useItems.map(itemLabel).join(', ')}. Treat this as part of the player's immediate action and resolve the attempt naturally in the scene.`
                : '',
            deleteText: deleteItems.length > 0
                ? `The player is deliberately getting rid of the following carried item(s): ${deleteItems.map(itemLabel).join(', ')}. Treat this as part of the player's immediate action; if the disposal succeeds, remove the item(s) from inventory in world-state tracking.`
                : ''
        };
        clearAllInventoryIntents();
    });

    window.addEventListener('vn:hud-ready', renderNotice);
    socket?.on('chat-db-switched', clearAllInventoryIntents);
    socket?.on('project-ready', clearAllInventoryIntents);
    socket?.on('vn-processing-complete', clearAllInventoryIntents);
})(context);
