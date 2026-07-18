const socket = io('http://localhost:14541');

// Add emitReceive helper
socket.emitReceive = function (eventName, data, timeout = 10000) {
    console.log(`[Socket] emitReceive: ${eventName}`, data);
    return new Promise((resolve) => {
        let responded = false;
        const timer = setTimeout(() => {
            if (!responded) {
                responded = true;
                console.warn(`[Socket] timeout for ${eventName}`);
                resolve({ success: false, error: 'timeout' });
            }
        }, timeout);

        this.emit(eventName, data);
        this.once(`${eventName}-response`, (result) => {
            if (!responded) {
                responded = true;
                clearTimeout(timer);
                console.log(`[Socket] response for ${eventName}:`, result);
                resolve(result);
            }
        });
    });
};

// #region INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    requestSceneHistory();

    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log('Manual refresh requested...');
            requestSceneHistory();
        });
    }

    // Add listener for the new delete button
    const deleteBtn = document.getElementById('delete-last-turn-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const confirmDelete = await Modals.confirm('Delete Last Turn', 'Are you sure you want to delete the last turn? This action cannot be undone.');
            if (confirmDelete) {
                console.log('Attempting to delete last turn...');
                try {
                    const response = await socket.emitReceive('delete-latest-turn');
                    if (response && response.success) {
                        console.log('Last turn deleted successfully.');
                        requestSceneHistory();
                    } else {
                        console.error('Failed to delete last turn:', response?.error);
                        Modals.alert('Error', `Error deleting last turn: ${response?.error || 'Unknown error'}`);
                    }
                } catch (error) {
                    console.error('Error during delete last turn request:', error);
                    Modals.alert('Error', `Error deleting last turn: ${error.message}`);
                }
            }
        });
    }

    socket.on('chat-db-switched', (data) => {
        console.log('Chat DB switched, refreshing scene history...', data);
        requestSceneHistory();
    });

    socket.on('vn-processing-complete', (data) => {
        console.log('Background tasks (thumbnails/synopsis) complete, refreshing scene history...', data);
        requestSceneHistory();
    });
});
// #endregion

// #region SCENE HISTORY REQUEST
async function requestSceneHistory() {
    const refreshBtn = document.getElementById('refresh-btn');
    try {
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
        }
        console.log('Requesting scene history data...');
        const response = await socket.emitReceive('get-scene-history-data');
        if (response && response.success) {
            renderSceneThumbnails(response.scenes);
        } else {
            console.error('Failed to get scene history:', response?.error);
            clearThumbnails();
        }
    } catch (error) {
        console.error('Error requesting scene history:', error);
        clearThumbnails();
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '↻ Refresh';
        }
    }
}

function clearThumbnails() {
    const container = document.getElementById('scene-thumbnails');
    if (container) container.innerHTML = '<p>No scenes found or database not loaded.</p>';
}
// #endregion

// #region SCENE THUMBNAIL RENDERING
function renderSceneThumbnails(scenes) {
    const container = document.getElementById('scene-thumbnails');
    container.innerHTML = '';

    if (!scenes || scenes.length === 0) {
        container.innerHTML = '<p>No scenes found in this project.</p>';
        return;
    }

    scenes.forEach((scene) => {
        const thumbnailDiv = document.createElement('div');
        thumbnailDiv.className = 'scene-thumbnail';

        const fullTitle = scene.title || `Turn ${scene.turnNumber || '?'}`;
        let synopsis = scene.synopsis || "No synopsis available.";
        if (synopsis.length > 350) {
            synopsis = synopsis.substring(0, 347) + '...';
        }
        thumbnailDiv.title = `${fullTitle}\n${synopsis}`;

        const backgroundDiv = document.createElement('div');
        backgroundDiv.className = 'scene-thumbnail-background';

        const turnBadge = document.createElement('div');
        turnBadge.className = 'scene-turn-badge';
        turnBadge.textContent = scene.turnNumber || '?';
        backgroundDiv.appendChild(turnBadge);

        const branchBtn = document.createElement('div');
        branchBtn.className = 'branch-btn';
        branchBtn.title = 'Branch narrative from here';
        branchBtn.innerHTML = '⌥'; // Branch/Option symbol
        branchBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger the thumbnail click (playback)
            branchScene(scene);
        });
        backgroundDiv.appendChild(branchBtn);

        const editBtn = document.createElement('div');
        editBtn.className = 'edit-btn';
        editBtn.title = 'Edit script and reprocess';
        editBtn.innerHTML = '✏️'; // Edit symbol
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Don't trigger the thumbnail click (playback)
            editScene(scene);
        });
        backgroundDiv.appendChild(editBtn);

        if (scene.thumbnail) {
            // Use the base64 thumbnail if available
            backgroundDiv.style.backgroundImage = `url('data:image/jpeg;base64,${scene.thumbnail}')`;
            backgroundDiv.style.backgroundSize = 'cover';
        } else if (scene.background) {
            // Fallback to the original background image if no thumbnail
            backgroundDiv.style.backgroundImage = `url('../../${scene.background}')`;
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'scene-info';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'scene-title';
        // Use provided title or default to Turn X
        titleDiv.textContent = scene.title || `Turn ${scene.turnNumber || '?'}`;

        const metadataDiv = document.createElement('div');
        metadataDiv.className = 'scene-metadata';
        metadataDiv.textContent = `${scene.sequence?.length || 0} dialogue lines`;

        infoDiv.appendChild(titleDiv);

        if (scene.abstractTitle) {
            const abstractTitleDiv = document.createElement('div');
            abstractTitleDiv.className = 'scene-abstract-title';
            abstractTitleDiv.textContent = scene.abstractTitle;
            infoDiv.appendChild(abstractTitleDiv);
        }

        infoDiv.appendChild(metadataDiv);

        thumbnailDiv.appendChild(backgroundDiv);
        thumbnailDiv.appendChild(infoDiv);

        thumbnailDiv.addEventListener('click', () => {
            playSceneFromHistory(scene);
        });

        container.appendChild(thumbnailDiv);
    });
}
// #endregion

// #region SCENE PLAYBACK
async function playSceneFromHistory(sceneData) {
    try {
        console.log('Requesting playback for scene:', sceneData.turnNumber);

        // Notify host via socket to switch to the viewer tab
        socket.emit('request-tab-switch', { tab: 'viewer' });

        // Instruct backend to play this specific turn
        socket.emit('play-historical-turn', { turnNumber: sceneData.turnNumber });

    } catch (error) {
        console.error('Error playing scene from history:', error);
    }
}
// #endregion

// #endregion

// #region BRANCHING LOGIC

async function branchScene(scene) {
    const defaultName = `branch_of_${scene.turnNumber}_${Date.now().toString().slice(-4)}`;
    const newNameRaw = await new Promise((resolve) => {
        Modals.prompt(
            `New branch from Turn ${scene.turnNumber}`,
            'Turns after the branch point will be deleted.',
            defaultName,
            (val) => resolve(val),
            () => resolve(null)
        );
    });
    
    if (newNameRaw === null) return;
    
    const newName = newNameRaw.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    if (!newName) {
        Modals.alert('Invalid Name', 'Please use only letters, numbers, and underscores.');
        return;
    }

    try {
        console.log(`Requesting branch creation: ${newName} from turn ${scene.turnNumber} (dbId: ${scene.dbId})`);
        
        const loader = Modals.show({
            title: 'Branching Narrative',
            content: `Creating "${newName}" from Turn ${scene.turnNumber}...`,
            showSpinner: true
        });
        
        const response = await socket.emitReceive('branch-narrative', {
            branchTurnNumber: scene.turnNumber,
            branchDbId: scene.dbId,
            newChatName: newName
        });

        loader.close();

        if (response && response.success) {
            console.log('Branch created successfully:', response);
            const shouldSwitch = await Modals.confirm('Success', `Branch "${newName}" created successfully! Switch to it now?`);
            if (shouldSwitch) {
                const switchLoader = Modals.show({
                    title: 'Switching Narrative',
                    content: `Opening "${newName}"...`,
                    showSpinner: true
                });

                try {
                    const switchResponse = await socket.emitReceive('activate-chat-db', {
                        chatDbPath: response.newChatPath
                    });

                    switchLoader.close();

                    if (switchResponse && switchResponse.success) {
                        socket.emit('request-tab-switch', { tab: 'viewer' });
                    } else {
                        console.error('Failed to switch branch:', switchResponse?.error);
                        Modals.alert('Switch Error', switchResponse?.error || 'Branch was created, but could not be opened.');
                    }
                } catch (switchError) {
                    switchLoader.close();
                    console.error('Error during branch switch:', switchError);
                    Modals.alert('Switch Error', switchError.message);
                }
            }
        } else {
            console.error('Failed to create branch:', response?.error);
            Modals.alert('Branch Error', response?.error || 'Unknown error during branching.');
        }
    } catch (error) {
        console.error('Error during branch-narrative request:', error);
        Modals.alert('Request Error', error.message);
    }
}

async function editScene(scene) {
    console.log(`Editing script for turn ${scene.turnNumber}...`);
    
    // Show loading state
    const loader = Modals.show({
        title: 'Loading Script',
        content: `Fetching original prose for Turn ${scene.turnNumber}...`,
        showSpinner: true
    });

    try {
        const response = await socket.emitReceive('get-turn-script', { turnNumber: scene.turnNumber });
        loader.close();

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to fetch script.');
        }

        const currentScript = response.script;

        // Create the modal content
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '15px';

        const textarea = document.createElement('textarea');
        textarea.className = 'edit-modal-textarea';
        textarea.value = currentScript;
        textarea.placeholder = "Enter the new prose for this turn...";
        
        const helpText = document.createElement('p');
        helpText.style.fontSize = '0.85em';
        helpText.style.color = 'var(--text-muted)';
        helpText.style.margin = '0';
        helpText.innerHTML = '<strong>Note:</strong> Reprocessing will skip the LLM Writer and jump straight to visual generation (emotions, sprites, music, backgrounds) based on your edited text.';

        container.appendChild(textarea);
        container.appendChild(helpText);

        Modals.show({
            title: `Edit Turn ${scene.turnNumber}`,
            content: container,
            className: 'modal-large',
            buttons: [
                {
                    text: 'Cancel',
                    class: 'secondary'
                },
                {
                    text: 'Save & Reprocess',
                    class: 'primary',
                    onclick: async (btn) => {
                        const newScript = textarea.value.trim();
                        if (!newScript) {
                            alert('Script cannot be empty.');
                            return;
                        }

                        btn.close();
                        
                        // Send reprocess request
                        socket.emit('reprocess-vn-turn', { 
                            turnNumber: scene.turnNumber, 
                            editedProse: newScript 
                        });
                        
                        // Tab switch is handled by backend, but we can do a local cleanup if needed
                    }
                }
            ]
        });

    } catch (error) {
        if (loader) loader.close();
        console.error('Error during script fetch:', error);
        Modals.alert('Error', `Could not load script: ${error.message}`);
    }
}
// #endregion
