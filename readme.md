# Cursor Talk to Figma MCP

# ✨ Figma Plugin Integration Setup (Safe Init)

This project currently runs a working MCP integration between Cursor AI and Figma. **Do not modify or refactor any code under `/src/talk_to_figma_mcp`, `/src/cursor_mcp_plugin`, or related socket/WebSocket infrastructure.**

---

## ✅ What's Working (DO NOT TOUCH)
- MCP WebSocket server (`src/socket.ts`)
- Cursor-to-Figma bridge (`talk_to_figma_mcp`)
- Message handlers and event protocol
- JSON config at `.cursor/mcp.json`

---

## 🧩 Preparing Figma Plugin Features

To safely introduce isolated plugin features (like Tile Map generation, annotation overlays, or component explorers), we are preparing a separate Figma Plugin structure.

### 🔧 Plugin Plan:
- All plugin logic is isolated in `/plugins/figma-plugin-*` folders
- Modular per-feature tabs and UI logic (e.g. `/ui/js/tilemap.js`, `/ui/js/export.js`)
- No shared state with MCP
- Plugin code uses only the [Figma Plugin API](https://www.figma.com/plugin-docs/api/api-reference/)

### 🗂 Plugin Dev Convention:
- Entry: `code.ts`
- UI: `ui.html` with tab-driven structure
- Shared logic: `/ui/js/*.js`
- Must respect cursor.json enforcement

---

## ⛔ Warning
- No plugin feature should access or mutate MCP logic.
- Cursor is instructed via `cursor.json` to **not touch anything outside plugin folders.**

---

This project implements a Model Context Protocol (MCP) integration between Cursor AI and Figma, allowing Cursor to communicate with Figma for reading designs and modifying them programmatically.

https://github.com/user-attachments/assets/129a14d2-ed73-470f-9a4c-2240b2a4885c

## Project Structure

- src/talk_to_figma_mcp/ - TypeScript MCP server for Figma integration
- src/cursor_mcp_plugin/ - Figma plugin for communicating with Cursor
- src/socket.ts - WebSocket server that facilitates communication between the MCP server and Figma plugin

## Get Started

1. Install Bun if you haven't already:

bash
curl -fsSL https://bun.sh/install | bash


2. Run setup, this will also install MCP in your Cursor's active project

bash
bun setup


3. Start the Websocket server

bash
bun socket


4. MCP server

bash
bunx cursor-talk-to-figma-mcp


5. Install [Figma Plugin](#figma-plugin)

## Quick Video Tutorial

[Video Link](https://www.linkedin.com/posts/sonnylazuardi_just-wanted-to-share-my-latest-experiment-activity-7307821553654657024-yrh8)

## Design Automation Example

**Bulk text content replacement**

Thanks to [@dusskapark](https://github.com/dusskapark) for contributing the bulk text replacement feature. Here is the [demo video](https://www.youtube.com/watch?v=j05gGT3xfCs).

## Manual Setup and Installation

### MCP Server: Integration with Cursor

Add the server to your Cursor MCP configuration in ~/.cursor/mcp.json:

json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "bunx",
      "args": ["cursor-talk-to-figma-mcp@latest"]
    }
  }
}


### WebSocket Server

Start the WebSocket server:

bash
bun socket


### Figma Plugin

1. In Figma, go to Plugins > Development > New Plugin
2. Choose "Link existing plugin"
3. Select the src/cursor_mcp_plugin/manifest.json file
4. The plugin should now be available in your Figma development plugins

## Windows + WSL Guide

1. Install bun via powershell

bash
powershell -c "irm bun.sh/install.ps1|iex"


2. Uncomment the hostname 0.0.0.0 in src/socket.ts

typescript
// uncomment this to allow connections in windows wsl
hostname: "0.0.0.0",


3. Start the websocket

bash
bun socket


## Usage

1. Start the WebSocket server
2. Install the MCP server in Cursor
3. Open Figma and run the Cursor MCP Plugin
4. Connect the plugin to the WebSocket server by joining a channel using join_channel
5. Use Cursor to communicate with Figma using the MCP tools

## MCP Tools

The MCP server provides the following tools for interacting with Figma:

### Document & Selection

- get_document_info - Get information about the current Figma document
- get_selection - Get information about the current selection
- read_my_design - Get detailed node information about the current selection without parameters
- get_node_info - Get detailed information about a specific node
- get_nodes_info - Get detailed information about multiple nodes by providing an array of node IDs

### Annotations

- get_annotations - Get all annotations in the current document or specific node
- set_annotation - Create or update an annotation with markdown support
- set_multiple_annotations - Batch create/update multiple annotations efficiently
- scan_nodes_by_types - Scan for nodes with specific types (useful for finding annotation targets)

### Creating Elements

- create_rectangle - Create a new rectangle with position, size, and optional name
- create_frame - Create a new frame with position, size, and optional name
- create_text - Create a new text node with customizable font properties

### Modifying text content

- scan_text_nodes - Scan text nodes with intelligent chunking for large designs
- set_text_content - Set the text content of a single text node
- set_multiple_text_contents - Batch update multiple text nodes efficiently

### Styling

- set_fill_color - Set the fill color of a node (RGBA)
- set_stroke_color - Set the stroke color and weight of a node
- set_corner_radius - Set the corner radius of a node with optional per-corner control

### Layout & Organization

- move_node - Move a node to a new position
- resize_node - Resize a node with new dimensions
- delete_node - Delete a node
- delete_multiple_nodes - Delete multiple nodes at once efficiently
- clone_node - Create a copy of an existing node with optional position offset

### Components & Styles

- get_styles - Get information about local styles
- get_local_components - Get information about local components
- create_component_instance - Create an instance of a component

### Export & Advanced

- export_node_as_image - Export a node as an image (PNG, JPG, SVG, or PDF) - limited support on image currently returning base64 as text

### Connection Management

- join_channel - Join a specific channel to communicate with Figma

## Development

### Building the Figma Plugin

1. Navigate to the Figma plugin directory:

   
cd src/cursor_mcp_plugin


2. Edit code.js and ui.html

## Best Practices

When working with the Figma MCP:

1. Always join a channel before sending commands
2. Get document overview using get_document_info first
3. Check current selection with get_selection before modifications
4. Use appropriate creation tools based on needs:
   - create_frame for containers
   - create_rectangle for basic shapes
   - create_text for text elements
5. Verify changes using get_node_info
6. Use component instances when possible for consistency
7. Handle errors appropriately as all commands can throw exceptions
8. For large designs:
   - Use chunking parameters in scan_text_nodes
   - Monitor progress through WebSocket updates
   - Implement appropriate error handling
9. For text operations:
   - Use batch operations when possible
   - Consider structural relationships
   - Verify changes with targeted exports
10. For converting legacy annotations:
    - Scan text nodes to identify numbered markers and descriptions
    - Use scan_nodes_by_types to find UI elements that annotations refer to
    - Match markers with their target elements using path, name, or proximity
    - Categorize annotations appropriately with get_annotations
    - Create native annotations with set_multiple_annotations in batches
    - Verify all annotations are properly linked to their targets
    - Delete legacy annotation nodes after successful conversion

## License

MIT

## Debugging Figma Plugin UI Events

When working with Figma plugin UI events, follow these debugging strategies:

### 1. DOM Loading and Initialization

Always wrap UI initialization code in a DOMContentLoaded event listener:

javascript
document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI elements here
  initializeUIElements();
  initializeEventListeners();
});


### 2. Debug Logging Strategy

Implement comprehensive debug logging:

javascript
// At script start
console.log('[Debug] Script starting');

// When finding UI elements
console.log('[Debug] UI Elements:', {
  element1: !!element1,
  element2: !!element2
});

// When adding event listeners
console.log('[Debug] Adding event listener to:', elementId);

// When events fire
console.log('[Debug] Event fired:', {
  type: eventType,
  details: eventDetails
});


### 3. Tab Content Management

For plugins with tabbed interfaces:

javascript
function initializeTabs() {
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Log tab switching
      console.log('[Debug] Switching to tab:', tab.id);
      
      // Update UI state
      updateTabState(tab);
      
      // Reinitialize tab-specific elements
      reinitializeTabContent(tab.id);
    });
  });
}

function reinitializeTabContent(tabId) {
  // Find and reinitialize elements in the tab
  // Useful when elements might not be available initially
  const tabContent = document.getElementById(`content-${tabId}`);
  if (tabContent) {
    initializeTabSpecificElements(tabContent);
  }
}


### 4. Event Listener Management

Track event listener attachment to prevent duplicates:

javascript
function addEventListenerSafely(element, event, handler) {
  if (!element._listeners) {
    element._listeners = new Set();
  }
  
  const handlerKey = `${event}_${handler.name}`;
  if (!element._listeners.has(handlerKey)) {
    element.addEventListener(event, handler);
    element._listeners.add(handlerKey);
    console.log(`[Debug] Added ${event} listener to ${element.id}`);
  }
}


### 5. Plugin-UI Communication

For communication between plugin code and UI:

javascript
// In UI code
parent.postMessage({ 
  pluginMessage: { 
    type: 'command-name',
    data: commandData
  } 
}, '*');

// In plugin code
figma.ui.onmessage = async (msg) => {
  console.log('[Plugin] Received message:', msg);
  
  switch (msg.type) {
    case 'command-name':
      try {
        const result = await handleCommand(msg.data);
        figma.ui.postMessage({
          type: 'command-result',
          data: result
        });
      } catch (error) {
        console.error('[Plugin] Error:', error);
        figma.ui.postMessage({
          type: 'command-error',
          error: error.message
        });
      }
      break;
  }
};


### 6. Common Issues and Solutions

1. **Hidden Elements**: When elements are in hidden tabs or sections:
   - Initialize listeners when tab becomes visible
   - Use event delegation for dynamically shown elements
   - Track element visibility state

2. **Event Listener Duplication**: When elements get reinitialized:
   - Track listener attachment using flags or Sets
   - Remove old listeners before adding new ones
   - Use event delegation where appropriate

3. **Timing Issues**: When elements aren't available immediately:
   - Wait for DOMContentLoaded
   - Use MutationObserver for dynamic content
   - Implement retry mechanisms for critical initializations

4. **Communication Issues**: When messages aren't received:
   - Verify message format matches expected schema
   - Add comprehensive logging on both sides
   - Implement error handling and timeouts

## Best Practices

1. **Logging**:
   - Use consistent log prefixes ([Debug], [Plugin], etc.)
   - Log both success and failure paths
   - Include relevant data in log messages

2. **Error Handling**:
   - Catch and log all errors
   - Provide user feedback for failures
   - Include error context in messages

3. **State Management**:
   - Track UI state explicitly
   - Validate state transitions
   - Handle edge cases (disconnections, errors)

4. **Code Organization**:
   - Separate concerns (UI, plugin logic, communication)
   - Use consistent naming conventions
   - Document complex interactions

5. **Testing**:
   - Test with different Figma selections
   - Verify all UI states
   - Test error scenarios

## Contributing

When adding new features:
1. Follow the debug logging pattern
2. Document UI-plugin interactions
3. Handle error cases
4. Test thoroughly in all UI states

