// engine/views/content_manager/modules/drag_drop.js

import { state, socket } from './state.js';

export function setupDragAndDrop(tree) {
  let draggedItem = null;

  tree.addEventListener('dragstart', (e) => {
    const target = e.target.closest('[draggable="true"]');
    if (!target) return;
    draggedItem = target;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', target.dataset.path);
    target.classList.add('dragging');
  });

  tree.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.tree-item-content, .main-directory-header');
    if (!target || target === draggedItem) return;

    const rect = target.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;

    if (e.clientY < midpoint) {
      target.classList.add('drop-indicator-top');
      target.classList.remove('drop-indicator-bottom');
    } else {
      target.classList.add('drop-indicator-bottom');
      target.classList.remove('drop-indicator-top');
    }
  });

  tree.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.tree-item-content, .main-directory-header');
    if (target) target.classList.remove('drop-indicator-top', 'drop-indicator-bottom');
  });

  tree.addEventListener('drop', async (e) => {
    e.preventDefault();
    const target = e.target.closest('.tree-item-content, .main-directory-header');
    if (!target || !draggedItem || target === draggedItem) {
      cleanupDrag();
      return;
    }

    const sourcePath = draggedItem.dataset.path;
    const targetPath = target.dataset.path;

    const getMajorCategory = (p) => {
      for (const key in state.coreFolderMap) {
        if (p.includes(key)) return key;
      }
      return 'other';
    };

    if (getMajorCategory(sourcePath) !== getMajorCategory(targetPath)) {
      Modals.alert('Movement Restricted', "Files cannot be moved between major engine categories.");
      cleanupDrag();
      return;
    }

    const isTargetHeader = target.classList.contains('main-directory-header');
    const rect = target.getBoundingClientRect();
    const isTop = e.clientY < (rect.top + rect.height / 2);
    const getFolder = (p) => p.substring(0, p.lastIndexOf('\\'));
    const sourceFolder = getFolder(sourcePath);
    const targetFolder = isTargetHeader ? targetPath : getFolder(targetPath);

    if (sourceFolder === targetFolder) {
      const siblings = findSiblingsRecursive(state.currentStructure, targetFolder);
      const newOrder = calculateNewOrder(siblings, sourcePath, targetPath, isTop);
      socket.emit('update-file-order', { filePath: sourcePath, newOrder });
    } else {
      const fileName = sourcePath.substring(sourcePath.lastIndexOf('\\') + 1);
      const confirmed = await Modals.confirm('Move File', `Move "${fileName}" to "${targetFolder}"?`);
      if (confirmed) {
        const siblings = findSiblingsRecursive(state.currentStructure, targetFolder);
        const newOrder = calculateNewOrder(siblings, null, targetPath, isTop);
        socket.emit('move-file-to-folder', { sourcePath, targetFolder, newOrder });
      }
    }
    cleanupDrag();
  });

  function cleanupDrag() {
    if (draggedItem) draggedItem.classList.remove('dragging');
    draggedItem = null;
    document.querySelectorAll('.drop-indicator-top, .drop-indicator-bottom').forEach(el => el.classList.remove('drop-indicator-top', 'drop-indicator-bottom'));
  }

  function findSiblingsRecursive(structure, folderPath) {
    if (!folderPath || state.currentStructure.some(item => item.path === folderPath && folderPath.split('\\').length <= 2)) {
      const parentPath = folderPath.substring(0, folderPath.lastIndexOf('\\'));
      if (!parentPath || parentPath.split('\\').length <= 1) return state.currentStructure;
    }
    for (const item of structure) {
      if (item.type === 'directory') {
        if (item.path === folderPath) return item.children || [];
        if (item.children) {
          const found = findSiblingsRecursive(item.children, folderPath);
          if (found && found.length > 0) return found;
        }
      }
    }
    return [];
  }

  function calculateNewOrder(siblings, sourcePath, targetPath, isTop) {
    if (!siblings || siblings.length === 0) return 100;
    const otherSiblings = siblings.filter(s => s.path !== sourcePath);
    const targetIndex = otherSiblings.findIndex(s => s.path === targetPath);
    if (targetIndex === -1) return (siblings[0]?.order || 100) / 2;
    let prevOrder, nextOrder;
    if (isTop) {
      const prev = otherSiblings[targetIndex - 1];
      const next = otherSiblings[targetIndex];
      prevOrder = prev ? prev.order : 0;
      nextOrder = next ? next.order : 100;
    } else {
      const prev = otherSiblings[targetIndex];
      const next = otherSiblings[targetIndex + 1];
      prevOrder = prev ? prev.order : 0;
      nextOrder = next ? next.order : (prevOrder + 200);
    }
    return (prevOrder + nextOrder) / 2;
  }
}
