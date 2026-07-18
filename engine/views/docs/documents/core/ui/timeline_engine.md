# Interactive Timeline & Branching

The **Timeline v2** is a specialized view for navigating the non-linear history of a project. It combines a high-performance rendering engine with a plugin-driven data architecture.

## 1. Backend Aggregator (`timeline.js`)

The backend prepares the timeline payload by combining core database metadata with plugin-contributed content.

### Timeline Providers
Plugins can register providers to inject information into the timeline:
- **Card Providers**: Add data to the main "Turn Card" (e.g., character mood summary).
- **Branch Providers**: Add "Side-Nodes" (branches) that emerge from a turn. This is used by the `relationship_tracker` to show affinity shifts and the `world_location_tracker` to show map movements.

```javascript
// Plugin Example
tools.timeline.registerProvider({
    type: 'card',
    side: 'right',
    fn: async (tc, tools) => {
        return { label: 'Location', value: tools.state.location };
    }
});
```

---

## 2. Frontend Rendering (`renderer_timeline.js`)

The frontend is designed to stay responsive even with thousands of turns.

### Virtualization & Performance
- **Dynamic Mounting**: The engine only renders the DOM elements for turns that are currently visible in the viewport.
- **LOD (Level of Detail)**: As the user zooms out, certain details (like branch synopses) are hidden to reduce layout complexity.

### The Pan & Zoom Engine
- **Inertia Panning**: Supports smooth, physics-based panning using mouse dragging.
- **Coordinate Mapping**: Uses a world-to-screen coordinate system to ensure that connection lines (`LeaderLine`) stay perfectly attached to nodes during zoom operations.

---

## 3. Interaction Mechanics

- **Branching**: Users can click the "Branch" icon on any turn to create a parallel story path.
- **Editing**: The "Edit" icon allows users to modify the turn's prose and reprocess the scene.
- **Node Centering**: The "Top" and "Bottom" navigation buttons use an easing-based `panTo` animation to focus the viewport on specific milestones.
