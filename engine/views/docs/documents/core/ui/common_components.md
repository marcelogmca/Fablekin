# Common UI Components

The engine provides a set of global JavaScript APIs for standard UI interactions. These components are automatically available in the main application environment and are themed according to the active design system.

## 1. Modals (`Modals` API)

The `Modals` object provides unified, animated dialogs. All modals support a `draggable` option and hardware-accelerated transitions.

### Alert
```javascript
Modals.alert("Access Denied", "You do not have permission to edit this project.");
```

### Confirmation
```javascript
const confirmed = await Modals.confirm("Delete Branch", "Are you sure? This cannot be undone.");
if (confirmed) {
    // Perform deletion
}
```

### Prompt
```javascript
const newName = await Modals.prompt("Rename Project", "Enter the new name:", "Current Name");
if (newName) {
    console.log("New project name:", newName);
}
```

### Custom Content
You can pass an `HTMLElement` or raw HTML string to the `show` method for complex layouts:
```javascript
Modals.show({
    title: "Advanced Settings",
    content: myCustomSettingsElement,
    width: "800px",
    buttons: [
        { text: "Save", class: "primary", onclick: () => save() }
    ]
});
```

---

## 2. Tooltips (`Tooltips` API)

The Tooltip system handles hover-based information with a consistent "Premium" look (glassmorphism + gold accents).

### Auto-Registration
Any element with a `data-tooltip` attribute will automatically trigger a tooltip on hover:
```html
<button data-tooltip="Starts the narrative generation pipeline">Generate</button>
```

### Manual Triggering
```javascript
Tooltips.show(targetElement, "Dynamic message content", { title: "Hint" });
```

---

## 3. Premium Select

A custom, stylized replacement for the native `<select>` element, supporting searchable options and custom styling.

```javascript
const select = new PremiumSelect(containerElement, {
    options: [
        { label: "Ollama", value: "ollama" },
        { label: "OpenRouter", value: "openrouter" }
    ],
    onChange: (val) => console.log(val)
});
```
