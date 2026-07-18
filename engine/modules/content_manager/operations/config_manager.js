const fs = require('fs/promises');
const path = require('path');
const { Logger } = require('../../utils');
const { isStructuredProjectConfig, toStructuredProjectConfig } = require('../../config/project_config_store');

function toPortableConfig(dirPath, config) {
  const structured = toStructuredProjectConfig(config);
  const files = {};
  for (const [filePath, value] of Object.entries(structured.files)) {
    files[path.isAbsolute(filePath) ? path.relative(dirPath, filePath) : filePath] = value;
  }
  return { ...structured, files };
}

async function saveFileConfig(dirPath, config) {
  const configPath = path.join(dirPath, `${path.basename(dirPath)}.config`);
  await fs.writeFile(configPath, JSON.stringify(toPortableConfig(dirPath, config), null, 2));
  Logger.log('ConfigManager', 'Persistence', `Configuration saved to: ${configPath}`);
}

async function loadFileConfig(dirPath) {
  const configPath = path.join(dirPath, `${path.basename(dirPath)}.config`);
  let config;
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    if (!isStructuredProjectConfig(parsed)) {
      throw new Error('Unsupported project config format. Delete and recreate the project config for this pre-release build.');
    }
    config = toStructuredProjectConfig(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') return toStructuredProjectConfig({});
    Logger.error('ConfigManager', 'Persistence', `Error loading config from: ${configPath}`, error);
    throw error;
  }

  const validFiles = {};
  let removedCount = 0;
  for (const [filePath, settings] of Object.entries(config.files)) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(dirPath, filePath);
    try {
      await fs.access(absolutePath);
      validFiles[absolutePath] = settings;
    } catch {
      Logger.log('ConfigManager', 'Lifecycle', `Removing config for non-existent file: ${absolutePath}`);
      removedCount++;
    }
  }
  config.files = validFiles;
  if (removedCount > 0) await saveFileConfig(dirPath, config);
  return config;
}

module.exports = { saveFileConfig, loadFileConfig };
