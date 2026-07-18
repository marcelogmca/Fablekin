const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { Logger } = require('../utils.js');

class SecureStorage {
    constructor() {
        this.secretsPath = null;
        this.secrets = {};
        this.isInitialized = false;
    }

    /**
     * Initializes the storage by setting the path and loading existing secrets.
     */
    async initialize() {
        if (this.isInitialized) return;

        try {
            // Path: AppData/Roaming/Fablekin/plugin_secrets.json
            const userData = app.getPath('userData');
            this.secretsPath = path.join(userData, 'plugin_secrets.json');

            await this._load();
            this.isInitialized = true;
            Logger.log('SecureStorage', 'System initialized.');
        } catch (error) {
            Logger.error('SecureStorage', 'Failed to initialize:', error);
        }
    }

    /**
     * Loads and decrypts secrets from disk.
     * @private
     */
    async _load() {
        try {
            if (!fsSync.existsSync(this.secretsPath)) {
                this.secrets = {};
                return;
            }

            const data = await fs.readFile(this.secretsPath, 'utf8');
            const encryptedData = JSON.parse(data);
            const decryptedSecrets = {};

            for (const pluginId in encryptedData) {
                decryptedSecrets[pluginId] = {};
                for (const key in encryptedData[pluginId]) {
                    const encryptedValue = encryptedData[pluginId][key];
                    try {
                        // safeStorage works with Buffers for encrypted data
                        const buffer = Buffer.from(encryptedValue, 'base64');
                        if (safeStorage.isEncryptionAvailable()) {
                            decryptedSecrets[pluginId][key] = safeStorage.decryptString(buffer);
                        } else {
                            Logger.warn('SecureStorage', `Encryption unavailable, cannot decrypt secret for ${pluginId}:${key}`);
                        }
                    } catch {
                        Logger.error('SecureStorage', `Decryption failed for ${pluginId}:${key}. It may have been encrypted on a different machine/user.`);
                    }
                }
            }

            this.secrets = decryptedSecrets;
        } catch (error) {
            Logger.error('SecureStorage', 'Error loading secrets:', error);
            this.secrets = {};
        }
    }

    /**
     * Encrypts and saves secrets to disk.
     * @private
     */
    async _save() {
        if (!this.secretsPath) throw new Error('Secure storage is not initialized.');
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('OS-backed encryption is unavailable; the secret was not saved.');
        }

        const encryptedData = {};
        for (const pluginId in this.secrets) {
            encryptedData[pluginId] = {};
            for (const key in this.secrets[pluginId]) {
                const buffer = safeStorage.encryptString(this.secrets[pluginId][key]);
                encryptedData[pluginId][key] = buffer.toString('base64');
            }
        }

        try {
            await fs.writeFile(this.secretsPath, JSON.stringify(encryptedData, null, 2), 'utf8');
        } catch (error) {
            Logger.error('SecureStorage', 'Error saving secrets:', error);
            throw error;
        }
    }

    /**
     * Gets a secret for a specific plugin.
     * @param {string} pluginId 
     * @param {string} key 
     * @returns {string|null}
     */
    getSecret(pluginId, key) {
        if (!this.secrets[pluginId]) return null;
        return this.secrets[pluginId][key] || null;
    }

    /**
     * Gets all secrets for a specific plugin.
     * @param {string} pluginId 
     * @returns {Object}
     */
    getPluginSecrets(pluginId) {
        return this.secrets[pluginId] || {};
    }

    /**
     * Sets a secret for a specific plugin and persists it.
     * @param {string} pluginId 
     * @param {string} key 
     * @param {string} value 
     */
    async setSecret(pluginId, key, value) {
        const previousPluginSecrets = this.secrets[pluginId] ? { ...this.secrets[pluginId] } : null;
        if (!this.secrets[pluginId]) this.secrets[pluginId] = {};
        this.secrets[pluginId][key] = value;

        try {
            await this._save();
        } catch (error) {
            if (previousPluginSecrets) this.secrets[pluginId] = previousPluginSecrets;
            else delete this.secrets[pluginId];
            throw error;
        }
    }
}

// Singleton instance
const instance = new SecureStorage();
module.exports = instance;
