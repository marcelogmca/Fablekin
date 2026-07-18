const io = require('socket.io-client');

function getSocketRuntimeConfig() {
    const params = new URLSearchParams(window.location.search || '');
    const host = params.get('socketHost') || '127.0.0.1';
    const portRaw = params.get('socketPort') || '14541';
    const token = params.get('socketToken') || '';
    const parsedPort = Number.parseInt(portRaw, 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 14541;

    return {
        url: `http://${host}:${port}`,
        token
    };
}

const runtimeSocket = getSocketRuntimeConfig();
const socketOptions = runtimeSocket.token
    ? { auth: { token: runtimeSocket.token }, query: { token: runtimeSocket.token } }
    : {};
const socket = io(runtimeSocket.url, socketOptions);

// #region DOM CONTENT LOADED LISTENER
document.addEventListener('DOMContentLoaded', () => {
    const projectList = document.getElementById('project-list');
    const createProjectBtn = document.getElementById('create-project-btn');
    const newProjectNameInput = document.getElementById('new-project-name');
    const errorMessage = document.getElementById('error-message');
// #endregion

// #region PROJECT LIST REQUEST
/**
 * Requests the list of all available projects from the backend.
 */
function requestProjectList() {
        socket.emit('get-all-projects');
    }

function formatLastOpened(lastOpenedAt) {
    const parsed = Number(lastOpenedAt);
    if (!Number.isFinite(parsed) || parsed <= 0) return 'Never opened';
    return new Date(parsed).toLocaleString();
}

// #endregion

// #region SOCKET EVENT HANDLERS
    // Populate project list
    socket.on('get-all-projects-response', ({ success, projects, error }) => {
        if (success) {
            projectList.innerHTML = ''; // Clear existing list
            if (projects.length === 0) {
                projectList.innerHTML = '<li>No projects found. Create one!</li>';
            } else {
                projects.forEach(project => {
                    const { slug, name, lastOpenedAt } = project;
                    const lastOpenedText = formatLastOpened(lastOpenedAt);
                    const li = document.createElement('li');
                    li.dataset.projectSlug = slug;
                    li.dataset.projectName = name; // Still keep for metadata if needed
                    li.classList.add('project-item');
                    
                    li.innerHTML = `
                        <div class="project-name-wrapper">
                            <span class="project-name">${name}</span>
                            <span class="project-last-opened">Last opened: ${lastOpenedText}</span>
                        </div>
                        <div class="project-actions">
                            <button class="action-icon-btn rename" title="Rename Project" data-project-slug="${slug}" data-project-name="${name}">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button class="action-icon-btn delete" title="Delete Project" data-project-slug="${slug}" data-project-name="${name}">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                        </div>
                    `;
                    
                    projectList.appendChild(li);
                });
            }
        } else {
            errorMessage.textContent = `Error loading projects: ${error}`;
        }
    });

    socket.on('delete-project-response', ({ success, error }) => {
        if (success) {
            requestProjectList();
        } else {
            errorMessage.textContent = `Error deleting project: ${error}`;
        }
    });

    socket.on('rename-project-response', ({ success, error }) => {
        if (success) {
            requestProjectList();
        } else {
            errorMessage.textContent = `Error renaming project: ${error}`;
        }
    });

    socket.on('create-new-project-response', ({ success, error }) => {
        if (success) {
            newProjectNameInput.value = '';
            requestProjectList(); // Refresh the list
        } else {
            errorMessage.textContent = `Error creating project: ${error}`;
        }
    });

    // Handle error on selection if the project fails to load
    socket.on('select-project-response', ({ success, error }) => {
        if (!success) {
            errorMessage.textContent = `Error selecting project: ${error}`;
        }
    });

    socket.on('connect_error', (_err) => {
        errorMessage.textContent = "Failed to connect to the backend server. Is it running?";
    });

    socket.on('connect', () => {
        errorMessage.textContent = '';
        requestProjectList();
    });

    socket.on('reconnect', () => {
        errorMessage.textContent = '';
        requestProjectList();
    });
// #endregion

// #region EVENT LISTENERS
    // Handle project creation
    createProjectBtn.addEventListener('click', () => {
        const projectName = newProjectNameInput.value.trim();
        if (projectName) {
            errorMessage.textContent = '';
            socket.emit('create-new-project', { projectName });
        } else {
            errorMessage.textContent = 'Project name cannot be empty.';
        }
    });

    // Handle project selection and actions
    projectList.addEventListener('click', async (event) => {
        const item = event.target.closest('li');
        if (!item) return;

        const projectSlug = item.dataset.projectSlug;
        const projectName = item.dataset.projectName;

        // Check if an action button was clicked
        const renameBtn = event.target.closest('.rename');
        const deleteBtn = event.target.closest('.delete');

        if (renameBtn) {
            event.stopPropagation();
            const newName = await Modals.prompt('Rename Project', `Enter a new name for "${projectName}":`, projectName);
            if (newName && newName !== projectName) {
                errorMessage.textContent = '';
                socket.emit('rename-project', { oldName: projectSlug, newName });
            }
            return;
        }

        if (deleteBtn) {
            event.stopPropagation();
            const confirmation = await Modals.prompt(
                '🔥 Delete Project?', 
                `This will <strong style="color: var(--status-danger)">PERMANENTLY DELETE</strong> the project <strong>"${projectName}"</strong> and all its associated data (lore, chronicles, assets).\n\nThis action cannot be undone.\n\nPlease type <span style="font-family: monospace; background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px;">DELETE</span> below to confirm:`, 
                { variant: 'danger', confirmText: 'Permanently Delete' }
            );
            
            if (confirmation === 'DELETE') {
                errorMessage.textContent = '';
                socket.emit('delete-project', { projectName: projectSlug });
            } else if (confirmation !== null) {
                errorMessage.textContent = 'Deletion cancelled. Confirmation text did not match.';
            }
            return;
        }

        // Default selection logic
        if (projectSlug) {
            socket.emit('select-project', { projectName: projectSlug });
        }
    });
});
// #endregion
