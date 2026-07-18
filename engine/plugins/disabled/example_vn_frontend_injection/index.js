const fs = require('fs/promises');
const path = require('path');

const REQUEST_EVENT = 'example_vn_frontend_injection:get-status';
const RESPONSE_EVENT = 'example_vn_frontend_injection:status';

module.exports = {
    id: 'example_vn_frontend_injection',
    name: 'Example: VN Frontend Injection',
    version: '1.0.0',
    author: 'Fablekin Core',
    category: 'Visual',
    isExamplePlugin: true,
    description: 'Demonstrates persistent VN HTML, CSS, JavaScript, socket updates, and tracked cleanup.',

    hooks: {
        HOOK_FRONTEND_INJECTION: {
            priority: 100,
            run: async (_context, tools) => {
                try {
                    const [html, css, js] = await Promise.all([
                        fs.readFile(path.join(__dirname, 'ui.html'), 'utf8'),
                        fs.readFile(path.join(__dirname, 'ui.css'), 'utf8'),
                        fs.readFile(path.join(__dirname, 'ui.js'), 'utf8')
                    ]);
                    return { id: 'example_vn_frontend_injection', html, css, js };
                } catch (error) {
                    tools.logger.error('Frontend', `Failed to load the VN frontend injection example: ${error.message}`);
                    return null;
                }
            }
        }
    },

    socketListeners: {
        [REQUEST_EVENT]: async (data, tools) => {
            const rawDialogueIndex = data?.dialogueIndex;
            tools.socket.emit(RESPONSE_EVENT, {
                success: true,
                message: 'Persistent VN injection is connected.',
                dialogueIndex: rawDialogueIndex !== null && rawDialogueIndex !== undefined && Number.isInteger(Number(rawDialogueIndex))
                    ? Number(rawDialogueIndex)
                    : null,
                turnNumber: Number(tools.turnContext?.turnNumber || 0)
            });
        }
    }
};
