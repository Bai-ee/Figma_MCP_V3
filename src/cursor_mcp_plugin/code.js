// This is the main code file for the Cursor MCP Figma plugin
// It handles Figma API commands

// Plugin state
const state = {
  serverPort: 3055, // Default port
};

// Helper function for progress updates
function sendProgressUpdate(
  commandId,
  commandType,
  status,
  progress,
  totalItems,
  processedItems,
  message,
  payload = null
) {
  const update = {
    type: "command_progress",
    commandId,
    commandType,
    status,
    progress,
    totalItems,
    processedItems,
    message,
    timestamp: Date.now(),
  };

  // Add optional chunk information if present
  if (payload) {
    if (
      payload.currentChunk !== undefined &&
      payload.totalChunks !== undefined
    ) {
      update.currentChunk = payload.currentChunk;
      update.totalChunks = payload.totalChunks;
      update.chunkSize = payload.chunkSize;
    }
    update.payload = payload;
  }

  // Send to UI
  figma.ui.postMessage(update);
  console.log(`Progress update: ${status} - ${progress}% - ${message}`);

  return update;
}

// Show UI
figma.showUI(__html__, { width: 350, height: 450 });

// OpenAI configuration
const openAIConfig = {
  apiKey: null,
  endpoint: 'https://api.openai.com/v1/chat/completions'
};

async function callOpenAI(message) {
  try {
    if (!openAIConfig.apiKey) {
      throw new Error('OpenAI API key not set. Please add your API key in the settings.');
    }

    console.log('Calling OpenAI API...');
    const response = await fetch(openAIConfig.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAIConfig.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful Figma design assistant. You can provide guidance on design principles, help with Figma features, and offer suggestions for improving designs.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}${
          errorData ? '\n' + JSON.stringify(errorData.error, null, 2) : ''
        }`
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

// Handle messages from the UI
figma.ui.onmessage = async (msg) => {
  console.log("Plugin received message:", msg);

  switch (msg.type) {
    case 'save-api-key':
      try {
        openAIConfig.apiKey = msg.key;
        await figma.clientStorage.setAsync('openai-api-key', msg.key);
        figma.ui.postMessage({ 
          type: 'chat-response',
          response: 'API key saved successfully! You can now start chatting.'
        });
      } catch (error) {
        console.error('Error saving API key:', error);
        figma.ui.postMessage({ 
          type: 'chat-response',
          response: 'Error saving API key. Please try again.'
        });
      }
      break;

    case 'get-api-key':
      try {
        const savedKey = await figma.clientStorage.getAsync('openai-api-key');
        if (savedKey) {
          openAIConfig.apiKey = savedKey;
          figma.ui.postMessage({ type: 'api-key', key: savedKey });
        }
      } catch (error) {
        console.error('Error loading API key:', error);
      }
      break;

    case 'chat-message':
      try {
        console.log('Processing chat message...');
        const response = await callOpenAI(msg.message);
        console.log('Received OpenAI response');
        figma.ui.postMessage({ 
          type: 'chat-response',
          response: response
        });
      } catch (error) {
        console.error('Chat error:', error);
        figma.ui.postMessage({ 
          type: 'chat-response',
          response: `Error: ${error.message}`
        });
      }
      break;

    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        // Send result back to UI
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
    
    case 'get-selection-info':
      console.log("Getting selection info via Figma API");
      const selection = figma.currentPage.selection;
      
      // Map selection to include only necessary properties
      const selectionInfo = selection.map(node => ({
        id: node.id,
        name: node.name,
        type: node.type,
        visible: node.visible,
        locked: node.locked,
        width: node.width,
        height: node.height,
        x: node.x,
        y: node.y,
        parent: node.parent ? {
          id: node.parent.id,
          type: node.parent.type,
          name: node.parent.name
        } : null
      }));
      
      console.log("Selection info:", selectionInfo);
      
      // Send selection info back to UI
      figma.ui.postMessage({
        type: 'selection-info',
        selection: selectionInfo
      });
      break;
    
    case 'export-selection':
      handleExportSelection(msg);
      break;

    case 'analyze-layers':
      handleAnalyzeLayers();
      break;

    case "log_selection":
      return logSelectionInfo();
  }
};

// Listen for plugin commands from menu
figma.on("run", ({ command }) => {
  figma.ui.postMessage({ type: "auto-connect" });
});

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Handle commands from UI
async function handleCommand(command, params) {
  console.log("Handling command:", command, "with params:", params);
  
  switch (command) {
    case "get_document_info":
      return await getDocumentInfo();
    case "get_selection":
      return await getSelection();
    case "get_node_info":
      if (!params || !params.nodeId) {
        throw new Error("Missing nodeId parameter");
      }
      return await getNodeInfo(params.nodeId);
    case "get_nodes_info":
      if (!params || !params.nodeIds || !Array.isArray(params.nodeIds)) {
        throw new Error("Missing or invalid nodeIds parameter");
      }
      return await getNodesInfo(params.nodeIds);
    case "read_my_design":
      return await readMyDesign();
    case "create_rectangle":
      return await createRectangle(params);
    case "create_frame":
      return await createFrame(params);
    case "create_text":
      return await createText(params);
    case "set_fill_color":
      return await setFillColor(params);
    case "set_stroke_color":
      return await setStrokeColor(params);
    case "move_node":
      return await moveNode(params);
    case "resize_node":
      return await resizeNode(params);
    case "delete_node":
      return await deleteNode(params);
    case "delete_multiple_nodes":
      return await deleteMultipleNodes(params);
    case "get_styles":
      return await getStyles();
    case "get_local_components":
      return await getLocalComponents();
    case "create_component_instance":
      return await createComponentInstance(params);
    case "export_node_as_image":
      try {
        const { nodeId, format = 'PNG', scale = 2 } = params;
        console.log(`Exporting node ${nodeId} as ${format} with scale ${scale}`);
        
        const node = figma.getNodeById(nodeId);
        if (!node) {
          throw new Error('Node not found');
        }

        const settings = {
          format: format,
          constraint: { type: 'SCALE', value: scale }
        };

        const bytes = await node.exportAsync(settings);
        console.log('Export successful, size:', bytes.length, 'bytes');
        
        sendCommandResult('export_node_as_image', { success: true });
      } catch (error) {
        console.error('Export failed:', error);
        sendCommandResult('export_node_as_image', { 
          success: false, 
          error: error.message 
        });
      }
      break;
    case "set_corner_radius":
      return await setCornerRadius(params);
    case "set_text_content":
      return await setTextContent(params);
    case "clone_node":
      return await cloneNode(params);
    case "scan_text_nodes":
      return await scanTextNodes(params);
    case "set_multiple_text_contents":
      return await setMultipleTextContents(params);
    case "get_annotations":
      return await getAnnotations(params);
    case "set_annotation":
      return await setAnnotation(params);
    case "scan_nodes_by_types":
      return await scanNodesByTypes(params);
    case "set_multiple_annotations":
      return await setMultipleAnnotations(params);
    case "set_layout_mode":
      return await setLayoutMode(params);
    case "set_padding":
      return await setPadding(params);
    case "set_axis_align":
      return await setAxisAlign(params);
    case "set_layout_sizing":
      return await setLayoutSizing(params);
    case "set_item_spacing":
      return await setItemSpacing(params);
    case "analyze_selection":
      return await analyzeSelection();
    case "convert_to_frame":
      return await convertToFrame(params);
    case "create_atlas":
      return await createAtlas(params);
    case "create_grid_frame":
      return await createGridFrame(params);
    case "snap_to_grid":
      return await snapToGrid(params);
    case "export_phaser_map":
      return await exportPhaserMap(params);
    case "generate-tiles":
      const { tileWidth, tileHeight, columns, rows, spacing } = params;
      const frame = figma.createFrame();
      frame.name = 'Tile Grid';
      frame.layoutMode = 'HORIZONTAL';
      frame.counterAxisSizingMode = 'AUTO';
      frame.primaryAxisSizingMode = 'AUTO';
      frame.layoutWrap = 'WRAP';
      frame.itemSpacing = spacing;
      frame.counterAxisSpacing = spacing;

      // Generate tiles
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const tile = figma.createRectangle();
          tile.name = `Tile ${row + 1}-${col + 1}`;
          tile.resize(tileWidth, tileHeight);
          frame.appendChild(tile);
        }
      }

      // Position the frame in the center of the viewport
      const { x, y } = figma.viewport.center;
      frame.x = x - (frame.width / 2);
      frame.y = y - (frame.height / 2);

      // Select the frame and zoom to it
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);

      return {
        success: true,
        frame: {
          id: frame.id,
          name: frame.name,
          width: frame.width,
          height: frame.height
        }
      };
    case "convert_to_basic_frame":
      return await convertToBasicFrame(params);
    case "frame-up":
      return await frameUp();
    case "export-tile-map":
      return await exportTileMap(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Command implementations

async function getDocumentInfo() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
    })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length,
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length,
      },
    ],
  };
}

async function getSelection() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
    })),
  };
}

function rgbaToHex(color) {
  var r = Math.round(color.r * 255);
  var g = Math.round(color.g * 255);
  var b = Math.round(color.b * 255);
  var a = color.a !== undefined ? Math.round(color.a * 255) : 255;

  if (a === 255) {
    return (
      "#" +
      [r, g, b]
        .map((x) => {
          return x.toString(16).padStart(2, "0");
        })
        .join("")
    );
  }

  return (
    "#" +
    [r, g, b, a]
      .map((x) => {
        return x.toString(16).padStart(2, "0");
      })
      .join("")
  );
}

function filterFigmaNode(node) {
  console.log(`🔍 Filtering node: ${node.name} (${node.id})`);
  if (node.type === "VECTOR") {
    console.log(`⏭️ Skipping VECTOR node: ${node.name}`);
    return null;
  }

  var filtered = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible, // Add visible property
  };
  console.log(`📝 Basic node info: ${JSON.stringify({ id: filtered.id, name: filtered.name, type: filtered.type, visible: filtered.visible })}`);

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      var processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;

      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map(
          (stop) => {
            var processedStop = Object.assign({}, stop);
            if (processedStop.color) {
              processedStop.color = rgbaToHex(processedStop.color);
            }
            delete processedStop.boundVariables;
            return processedStop;
          }
        );
      }

      if (processedFill.color) {
        processedFill.color = rgbaToHex(processedFill.color);
      }

      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      var processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) {
        processedStroke.color = rgbaToHex(processedStroke.color);
      }
      return processedStroke;
    });
  }

  if (node.cornerRadius !== undefined) {
    filtered.cornerRadius = node.cornerRadius;
  }

  if (node.absoluteBoundingBox) {
    filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  if (node.characters) {
    filtered.characters = node.characters;
  }

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx,
    };
  }

  if (node.children) {
    console.log(`👶 Processing ${node.children.length} children of node ${node.name}`);
    filtered.children = node.children
      .map((child) => {
        const filteredChild = filterFigmaNode(child);
        if (filteredChild) {
          console.log(`✅ Processed child: ${child.name}, visible: ${filteredChild.visible}`);
        }
        return filteredChild;
      })
      .filter((child) => {
        if (child === null) {
          console.log(`⏭️ Filtered out null child`);
        }
        return child !== null;
      });
  }

  console.log(`✅ Completed filtering node: ${node.name}, visible: ${filtered.visible}`);
  return filtered;
}

async function getNodeInfo(nodeId) {
  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  const response = await node.exportAsync({
    format: "JSON_REST_V1",
  });

  return filterFigmaNode(response.document);
}

async function getNodesInfo(nodeIds) {
  try {
    // Load all nodes in parallel
    const nodes = await Promise.all(
      nodeIds.map((id) => figma.getNodeByIdAsync(id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function readMyDesign() {
  try {
    // Load all selected nodes in parallel
    const nodes = await Promise.all(
      figma.currentPage.selection.map((node) => figma.getNodeByIdAsync(node.id))
    );

    // Filter out any null values (nodes that weren't found)
    const validNodes = nodes.filter((node) => node !== null);

    // Export all valid nodes in parallel
    const responses = await Promise.all(
      validNodes.map(async (node) => {
        const response = await node.exportAsync({
          format: "JSON_REST_V1",
        });
        return {
          nodeId: node.id,
          document: filterFigmaNode(response.document),
        };
      })
    );

    return responses;
  } catch (error) {
    throw new Error(`Error getting nodes info: ${error.message}`);
  }
}

async function createRectangle(params) {
  const {
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    name = "Rectangle",
    parentId,
  } = params || {};

  const rect = figma.createRectangle();
  rect.x = x;
  rect.y = y;
  rect.resize(width, height);
  rect.name = name;

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(rect);
  } else {
    figma.currentPage.appendChild(rect);
  }

  return {
    id: rect.id,
    name: rect.name,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    parentId: rect.parent ? rect.parent.id : undefined,
  };
}

async function createFrame(params) {
  console.log('🎨 Creating frame with params:', params);

  try {
    // Get current selection
    const selection = figma.currentPage.selection;
    if (!selection || selection.length === 0) {
      throw new Error('No selection found');
    }

    // Calculate center position of selection
    const bounds = selection.reduce((acc, node) => {
      if (!acc) {
        return {
          left: node.x,
          right: node.x + node.width,
          top: node.y,
          bottom: node.y + node.height
        };
      }
      return {
        left: Math.min(acc.left, node.x),
        right: Math.max(acc.right, node.x + node.width),
        top: Math.min(acc.top, node.y),
        bottom: Math.max(acc.bottom, node.y + node.height)
      };
    }, null);

    if (!bounds) {
      throw new Error('Could not calculate bounds');
    }

    const centerX = bounds.left + (bounds.right - bounds.left) / 2 - params.width / 2;
    const centerY = bounds.top + (bounds.bottom - bounds.top) / 2 - params.height / 2;

    // Create frame
    const frame = figma.createFrame();
    frame.x = centerX;
    frame.y = centerY;
    frame.resize(params.width, params.height);
    frame.name = params.name || 'New Frame';

    // Set layout properties
    if (params.layoutMode) {
      frame.layoutMode = params.layoutMode;
      frame.primaryAxisAlignItems = params.primaryAxisAlignItems || 'CENTER';
      frame.counterAxisAlignItems = params.counterAxisAlignItems || 'CENTER';
      frame.layoutSizingHorizontal = params.layoutSizingHorizontal || 'FIXED';
      frame.layoutSizingVertical = params.layoutSizingVertical || 'FIXED';
    }

    // Set fill color if provided
    if (params.fillColor) {
      frame.fills = [{
        type: 'SOLID',
        color: {
          r: params.fillColor.r,
          g: params.fillColor.g,
          b: params.fillColor.b
        },
        opacity: params.fillColor.a || 1
      }];
    }

    console.log('✅ Frame created successfully:', frame.id);
    figma.notify('Frame created successfully');

  } catch (error) {
    console.error('❌ Error creating frame:', error);
    figma.notify('Error creating frame: ' + error.message, { error: true });
  }
}

async function createText(params) {
  const {
    x = 0,
    y = 0,
    text = "Text",
    fontSize = 14,
    fontWeight = 400,
    fontColor = { r: 0, g: 0, b: 0, a: 1 }, // Default to black
    name = "",
    parentId,
  } = params || {};

  // Map common font weights to Figma font styles
  const getFontStyle = (weight) => {
    switch (weight) {
      case 100:
        return "Thin";
      case 200:
        return "Extra Light";
      case 300:
        return "Light";
      case 400:
        return "Regular";
      case 500:
        return "Medium";
      case 600:
        return "Semi Bold";
      case 700:
        return "Bold";
      case 800:
        return "Extra Bold";
      case 900:
        return "Black";
      default:
        return "Regular";
    }
  };

  const textNode = figma.createText();
  textNode.x = x;
  textNode.y = y;
  textNode.name = name || text;
  try {
    await figma.loadFontAsync({
      family: "Inter",
      style: getFontStyle(fontWeight),
    });
    textNode.fontName = { family: "Inter", style: getFontStyle(fontWeight) };
    textNode.fontSize = parseInt(fontSize);
  } catch (error) {
    console.error("Error setting font size", error);
  }
  setCharacters(textNode, text);

  // Set text color
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(fontColor.r) || 0,
      g: parseFloat(fontColor.g) || 0,
      b: parseFloat(fontColor.b) || 0,
    },
    opacity: parseFloat(fontColor.a) || 1,
  };
  textNode.fills = [paintStyle];

  // If parentId is provided, append to that node, otherwise append to current page
  if (parentId) {
    const parentNode = await figma.getNodeByIdAsync(parentId);
    if (!parentNode) {
      throw new Error(`Parent node not found with ID: ${parentId}`);
    }
    if (!("appendChild" in parentNode)) {
      throw new Error(`Parent node does not support children: ${parentId}`);
    }
    parentNode.appendChild(textNode);
  } else {
    figma.currentPage.appendChild(textNode);
  }

  return {
    id: textNode.id,
    name: textNode.name,
    x: textNode.x,
    y: textNode.y,
    width: textNode.width,
    height: textNode.height,
    characters: textNode.characters,
    fontSize: textNode.fontSize,
    fontWeight: fontWeight,
    fontColor: fontColor,
    fontName: textNode.fontName,
    fills: textNode.fills,
    parentId: textNode.parent ? textNode.parent.id : undefined,
  };
}

async function setFillColor(params) {
  console.log("setFillColor", params);
  const {
    nodeId,
    color: { r, g, b, a },
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("fills" in node)) {
    throw new Error(`Node does not support fills: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: parseFloat(r) || 0,
    g: parseFloat(g) || 0,
    b: parseFloat(b) || 0,
    a: parseFloat(a) || 1,
  };

  // Set fill
  const paintStyle = {
    type: "SOLID",
    color: {
      r: parseFloat(rgbColor.r),
      g: parseFloat(rgbColor.g),
      b: parseFloat(rgbColor.b),
    },
    opacity: parseFloat(rgbColor.a),
  };

  console.log("paintStyle", paintStyle);

  node.fills = [paintStyle];

  return {
    id: node.id,
    name: node.name,
    fills: [paintStyle],
  };
}

async function setStrokeColor(params) {
  const {
    nodeId,
    color: { r, g, b, a },
    weight = 1,
  } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${nodeId}`);
  }

  // Create RGBA color
  const rgbColor = {
    r: r !== undefined ? r : 0,
    g: g !== undefined ? g : 0,
    b: b !== undefined ? b : 0,
    a: a !== undefined ? a : 1,
  };

  // Set stroke
  const paintStyle = {
    type: "SOLID",
    color: {
      r: rgbColor.r,
      g: rgbColor.g,
      b: rgbColor.b,
    },
    opacity: rgbColor.a,
  };

  node.strokes = [paintStyle];

  // Set stroke weight if available
  if ("strokeWeight" in node) {
    node.strokeWeight = weight;
  }

  return {
    id: node.id,
    name: node.name,
    strokes: node.strokes,
    strokeWeight: "strokeWeight" in node ? node.strokeWeight : undefined,
  };
}

async function moveNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (x === undefined || y === undefined) {
    throw new Error("Missing x or y parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("x" in node) || !("y" in node)) {
    throw new Error(`Node does not support position: ${nodeId}`);
  }

  node.x = x;
  node.y = y;

  return {
    id: node.id,
    name: node.name,
    x: node.x,
    y: node.y,
  };
}

async function resizeNode(params) {
  const { nodeId, width, height } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (width === undefined || height === undefined) {
    throw new Error("Missing width or height parameters");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (!("resize" in node)) {
    throw new Error(`Node does not support resizing: ${nodeId}`);
  }

  node.resize(width, height);

  return {
    id: node.id,
    name: node.name,
    width: node.width,
    height: node.height,
  };
}

async function deleteNode(params) {
  const { nodeId } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Save node info before deleting
  const nodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  node.remove();

  return nodeInfo;
}

async function getStyles() {
  const styles = {
    colors: await figma.getLocalPaintStylesAsync(),
    texts: await figma.getLocalTextStylesAsync(),
    effects: await figma.getLocalEffectStylesAsync(),
    grids: await figma.getLocalGridStylesAsync(),
  };

  return {
    colors: styles.colors.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      paint: style.paints[0],
    })),
    texts: styles.texts.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
      fontSize: style.fontSize,
      fontName: style.fontName,
    })),
    effects: styles.effects.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
    grids: styles.grids.map((style) => ({
      id: style.id,
      name: style.name,
      key: style.key,
    })),
  };
}

async function getLocalComponents() {
  await figma.loadAllPagesAsync();

  const components = figma.root.findAllWithCriteria({
    types: ["COMPONENT"],
  });

  return {
    count: components.length,
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      key: "key" in component ? component.key : null,
    })),
  };
}

async function createComponentInstance(params) {
  const { componentKey, x = 0, y = 0 } = params || {};

  if (!componentKey) {
    throw new Error("Missing componentKey parameter");
  }

  try {
    const component = await figma.importComponentByKeyAsync(componentKey);
    const instance = component.createInstance();

    instance.x = x;
    instance.y = y;

    figma.currentPage.appendChild(instance);

    return {
      id: instance.id,
      name: instance.name,
      x: instance.x,
      y: instance.y,
      width: instance.width,
      height: instance.height,
      componentId: instance.componentId,
    };
  } catch (error) {
    throw new Error(`Error creating component instance: ${error.message}`);
  }
}

async function setCornerRadius(params) {
  const { nodeId, radius, corners } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (radius === undefined) {
    throw new Error("Missing radius parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Check if node supports corner radius
  if (!("cornerRadius" in node)) {
    throw new Error(`Node does not support corner radius: ${nodeId}`);
  }

  // If corners array is provided, set individual corner radii
  if (corners && Array.isArray(corners) && corners.length === 4) {
    if ("topLeftRadius" in node) {
      // Node supports individual corner radii
      if (corners[0]) node.topLeftRadius = radius;
      if (corners[1]) node.topRightRadius = radius;
      if (corners[2]) node.bottomRightRadius = radius;
      if (corners[3]) node.bottomLeftRadius = radius;
    } else {
      // Node only supports uniform corner radius
      node.cornerRadius = radius;
    }
  } else {
    // Set uniform corner radius
    node.cornerRadius = radius;
  }

  return {
    id: node.id,
    name: node.name,
    cornerRadius: "cornerRadius" in node ? node.cornerRadius : undefined,
    topLeftRadius: "topLeftRadius" in node ? node.topLeftRadius : undefined,
    topRightRadius: "topRightRadius" in node ? node.topRightRadius : undefined,
    bottomRightRadius:
      "bottomRightRadius" in node ? node.bottomRightRadius : undefined,
    bottomLeftRadius:
      "bottomLeftRadius" in node ? node.bottomLeftRadius : undefined,
  };
}

async function setTextContent(params) {
  const { nodeId, text } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  if (text === undefined) {
    throw new Error("Missing text parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  if (node.type !== "TEXT") {
    throw new Error(`Node is not a text node: ${nodeId}`);
  }

  try {
    await figma.loadFontAsync(node.fontName);

    await setCharacters(node, text);

    return {
      id: node.id,
      name: node.name,
      characters: node.characters,
      fontName: node.fontName,
    };
  } catch (error) {
    throw new Error(`Error setting text content: ${error.message}`);
  }
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Set up selection change listener
    figma.on('selectionchange', () => {
      logSelectionInfo();
    });

    // Log initial selection if any
    if (figma.currentPage.selection.length > 0) {
      logSelectionInfo();
    }

  } catch (error) {
    console.error('Error initializing plugin:', error);
  }
})();

function uniqBy(arr, predicate) {
  const cb = typeof predicate === "function" ? predicate : (o) => o[predicate];
  return [
    ...arr
      .reduce((map, item) => {
        const key = item === null || item === undefined ? item : cb(item);

        map.has(key) || map.set(key, item);

        return map;
      }, new Map())
      .values(),
  ];
}
const setCharacters = async (node, characters, options) => {
  const fallbackFont = (options && options.fallbackFont) || {
    family: "Inter",
    style: "Regular",
  };
  try {
    if (node.fontName === figma.mixed) {
      if (options && options.smartStrategy === "prevail") {
        const fontHashTree = {};
        for (let i = 1; i < node.characters.length; i++) {
          const charFont = node.getRangeFontName(i - 1, i);
          const key = `${charFont.family}::${charFont.style}`;
          fontHashTree[key] = fontHashTree[key] ? fontHashTree[key] + 1 : 1;
        }
        const prevailedTreeItem = Object.entries(fontHashTree).sort(
          (a, b) => b[1] - a[1]
        )[0];
        const [family, style] = prevailedTreeItem[0].split("::");
        const prevailedFont = {
          family,
          style,
        };
        await figma.loadFontAsync(prevailedFont);
        node.fontName = prevailedFont;
      } else if (options && options.smartStrategy === "strict") {
        return setCharactersWithStrictMatchFont(node, characters, fallbackFont);
      } else if (options && options.smartStrategy === "experimental") {
        return setCharactersWithSmartMatchFont(node, characters, fallbackFont);
      } else {
        const firstCharFont = node.getRangeFontName(0, 1);
        await figma.loadFontAsync(firstCharFont);
        node.fontName = firstCharFont;
      }
    } else {
      await figma.loadFontAsync({
        family: node.fontName.family,
        style: node.fontName.style,
      });
    }
  } catch (err) {
    console.warn(
      `Failed to load "${node.fontName["family"]} ${node.fontName["style"]}" font and replaced with fallback "${fallbackFont.family} ${fallbackFont.style}"`,
      err
    );
    await figma.loadFontAsync(fallbackFont);
    node.fontName = fallbackFont;
  }
  try {
    node.characters = characters;
    return true;
  } catch (err) {
    console.warn(`Failed to set characters. Skipped.`, err);
    return false;
  }
};

const setCharactersWithStrictMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const fontHashTree = {};
  for (let i = 1; i < node.characters.length; i++) {
    const startIdx = i - 1;
    const startCharFont = node.getRangeFontName(startIdx, i);
    const startCharFontVal = `${startCharFont.family}::${startCharFont.style}`;
    while (i < node.characters.length) {
      i++;
      const charFont = node.getRangeFontName(i - 1, i);
      if (startCharFontVal !== `${charFont.family}::${charFont.style}`) {
        break;
      }
    }
    fontHashTree[`${startIdx}_${i}`] = startCharFontVal;
  }
  await figma.loadFontAsync(fallbackFont);
  node.fontName = fallbackFont;
  node.characters = characters;
  console.log(fontHashTree);
  await Promise.all(
    Object.keys(fontHashTree).map(async (range) => {
      console.log(range, fontHashTree[range]);
      const [start, end] = range.split("_");
      const [family, style] = fontHashTree[range].split("::");
      const matchedFont = {
        family,
        style,
      };
      await figma.loadFontAsync(matchedFont);
      return node.setRangeFontName(Number(start), Number(end), matchedFont);
    })
  );
  return true;
};

const getDelimiterPos = (str, delimiter, startIdx = 0, endIdx = str.length) => {
  const indices = [];
  let temp = startIdx;
  for (let i = startIdx; i < endIdx; i++) {
    if (
      str[i] === delimiter &&
      i + startIdx !== endIdx &&
      temp !== i + startIdx
    ) {
      indices.push([temp, i + startIdx]);
      temp = i + startIdx + 1;
    }
  }
  temp !== endIdx && indices.push([temp, endIdx]);
  return indices.filter(Boolean);
};

const buildLinearOrder = (node) => {
  const fontTree = [];
  const newLinesPos = getDelimiterPos(node.characters, "\n");
  newLinesPos.forEach(([newLinesRangeStart, newLinesRangeEnd], n) => {
    const newLinesRangeFont = node.getRangeFontName(
      newLinesRangeStart,
      newLinesRangeEnd
    );
    if (newLinesRangeFont === figma.mixed) {
      const spacesPos = getDelimiterPos(
        node.characters,
        " ",
        newLinesRangeStart,
        newLinesRangeEnd
      );
      spacesPos.forEach(([spacesRangeStart, spacesRangeEnd], s) => {
        const spacesRangeFont = node.getRangeFontName(
          spacesRangeStart,
          spacesRangeEnd
        );
        if (spacesRangeFont === figma.mixed) {
          const spacesRangeFont = node.getRangeFontName(
            spacesRangeStart,
            spacesRangeStart[0]
          );
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        } else {
          fontTree.push({
            start: spacesRangeStart,
            delimiter: " ",
            family: spacesRangeFont.family,
            style: spacesRangeFont.style,
          });
        }
      });
    } else {
      fontTree.push({
        start: newLinesRangeStart,
        delimiter: "\n",
        family: newLinesRangeFont.family,
        style: newLinesRangeFont.style,
      });
    }
  });
  return fontTree
    .sort((a, b) => +a.start - +b.start)
    .map(({ family, style, delimiter }) => ({ family, style, delimiter }));
};

const setCharactersWithSmartMatchFont = async (
  node,
  characters,
  fallbackFont
) => {
  const rangeTree = buildLinearOrder(node);
  const fontsToLoad = uniqBy(
    rangeTree,
    ({ family, style }) => `${family}::${style}`
  ).map(({ family, style }) => ({
    family,
    style,
  }));

  await Promise.all([...fontsToLoad, fallbackFont].map(figma.loadFontAsync));

  node.fontName = fallbackFont;
  node.characters = characters;

  let prevPos = 0;
  rangeTree.forEach(({ family, style, delimiter }) => {
    if (prevPos < node.characters.length) {
      const delimeterPos = node.characters.indexOf(delimiter, prevPos);
      const endPos =
        delimeterPos > prevPos ? delimeterPos : node.characters.length;
      const matchedFont = {
        family,
        style,
      };
      node.setRangeFontName(prevPos, endPos, matchedFont);
      prevPos = endPos + 1;
    }
  });
  return true;
};

// Add the cloneNode function implementation
async function cloneNode(params) {
  const { nodeId, x, y } = params || {};

  if (!nodeId) {
    throw new Error("Missing nodeId parameter");
  }

  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node not found with ID: ${nodeId}`);
  }

  // Clone the node
  const clone = node.clone();

  // If x and y are provided, move the clone to that position
  if (x !== undefined && y !== undefined) {
    if (!("x" in clone) || !("y" in clone)) {
      throw new Error(`Cloned node does not support position: ${nodeId}`);
    }
    clone.x = x;
    clone.y = y;
  }

  // Add the clone to the same parent as the original node
  if (node.parent) {
    node.parent.appendChild(clone);
  } else {
    figma.currentPage.appendChild(clone);
  }

  return {
    id: clone.id,
    name: clone.name,
    x: "x" in clone ? clone.x : undefined,
    y: "y" in clone ? clone.y : undefined,
    width: "width" in clone ? clone.width : undefined,
    height: "height" in clone ? clone.height : undefined,
  };
}

async function scanTextNodes(params) {
  console.log(`Starting to scan text nodes from node ID: ${params.nodeId}`);
  const {
    nodeId,
    useChunking = true,
    chunkSize = 10,
    commandId = generateCommandId(),
  } = params || {};

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    console.error(`Node with ID ${nodeId} not found`);
    // Send error progress update
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "error",
      0,
      0,
      0,
      `Node with ID ${nodeId} not found`,
      { error: `Node not found: ${nodeId}` }
    );
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // If chunking is not enabled, use the original implementation
  if (!useChunking) {
    const textNodes = [];
    try {
      // Send started progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "started",
        0,
        1, // Not known yet how many nodes there are
        0,
        `Starting scan of node "${node.name || nodeId}" without chunking`,
        null
      );

      await findTextNodes(node, [], 0, textNodes);

      // Send completed progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "completed",
        100,
        textNodes.length,
        textNodes.length,
        `Scan complete. Found ${textNodes.length} text nodes.`,
        { textNodes }
      );

      return {
        success: true,
        message: `Scanned ${textNodes.length} text nodes.`,
        count: textNodes.length,
        textNodes: textNodes,
        commandId,
      };
    } catch (error) {
      console.error("Error scanning text nodes:", error);

      // Send error progress update
      sendProgressUpdate(
        commandId,
        "scan_text_nodes",
        "error",
        0,
        0,
        0,
        `Error scanning text nodes: ${error.message}`,
        { error: error.message }
      );

      throw new Error(`Error scanning text nodes: ${error.message}`);
    }
  }

  // Chunked implementation
  console.log(`Using chunked scanning with chunk size: ${chunkSize}`);

  // First, collect all nodes to process (without processing them yet)
  const nodesToProcess = [];

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "started",
    0,
    0, // Not known yet how many nodes there are
    0,
    `Starting chunked scan of node "${node.name || nodeId}"`,
    { chunkSize }
  );

  await collectNodesToProcess(node, [], 0, nodesToProcess);

  const totalNodes = nodesToProcess.length;
  console.log(`Found ${totalNodes} total nodes to process`);

  // Calculate number of chunks needed
  const totalChunks = Math.ceil(totalNodes / chunkSize);
  console.log(`Will process in ${totalChunks} chunks`);

  // Send update after node collection
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "in_progress",
    5, // 5% progress for collection phase
    totalNodes,
    0,
    `Found ${totalNodes} nodes to scan. Will process in ${totalChunks} chunks.`,
    {
      totalNodes,
      totalChunks,
      chunkSize,
    }
  );

  // Process nodes in chunks
  const allTextNodes = [];
  let processedNodes = 0;
  let chunksProcessed = 0;

  for (let i = 0; i < totalNodes; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, totalNodes);
    console.log(
      `Processing chunk ${chunksProcessed + 1}/${totalChunks} (nodes ${i} to ${
        chunkEnd - 1
      })`
    );

    // Send update before processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processing chunk ${chunksProcessed + 1}/${totalChunks}`,
      {
        currentChunk: chunksProcessed + 1,
        totalChunks,
        textNodesFound: allTextNodes.length,
      }
    );

    const chunkNodes = nodesToProcess.slice(i, chunkEnd);
    const chunkTextNodes = [];

    // Process each node in this chunk
    for (const nodeInfo of chunkNodes) {
      if (nodeInfo.node.type === "TEXT") {
        try {
          const textNodeInfo = await processTextNode(
            nodeInfo.node,
            nodeInfo.parentPath,
            nodeInfo.depth
          );
          if (textNodeInfo) {
            chunkTextNodes.push(textNodeInfo);
          }
        } catch (error) {
          console.error(`Error processing text node: ${error.message}`);
          // Continue with other nodes
        }
      }

      // Brief delay to allow UI updates and prevent freezing
      await delay(5);
    }

    // Add results from this chunk
    allTextNodes.push(...chunkTextNodes);
    processedNodes += chunkNodes.length;
    chunksProcessed++;

    // Send update after processing chunk
    sendProgressUpdate(
      commandId,
      "scan_text_nodes",
      "in_progress",
      Math.round(5 + (chunksProcessed / totalChunks) * 90), // 5-95% for processing
      totalNodes,
      processedNodes,
      `Processed chunk ${chunksProcessed}/${totalChunks}. Found ${allTextNodes.length} text nodes so far.`,
      {
        currentChunk: chunksProcessed,
        totalChunks,
        processedNodes,
        textNodesFound: allTextNodes.length,
        chunkResult: chunkTextNodes,
      }
    );

    // Small delay between chunks to prevent UI freezing
    if (i + chunkSize < totalNodes) {
      await delay(50);
    }
  }

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "scan_text_nodes",
    "completed",
    100,
    totalNodes,
    processedNodes,
    `Scan complete. Found ${allTextNodes.length} text nodes.`,
    {
      textNodes: allTextNodes,
      processedNodes,
      chunks: chunksProcessed,
    }
  );

  return {
    success: true,
    message: `Chunked scan complete. Found ${allTextNodes.length} text nodes.`,
    totalNodes: allTextNodes.length,
    processedNodes: processedNodes,
    chunks: chunksProcessed,
    textNodes: allTextNodes,
    commandId,
  };
}

// Helper function to collect all nodes that need to be processed
async function collectNodesToProcess(
  node,
  parentPath = [],
  depth = 0,
  nodesToProcess = []
) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  // Add this node to the processing list
  nodesToProcess.push({
    node: node,
    parentPath: nodePath,
    depth: depth,
  });

  // Recursively add children
  if ("children" in node) {
    for (const child of node.children) {
      await collectNodesToProcess(child, nodePath, depth + 1, nodesToProcess);
    }
  }
}

// Process a single text node
async function processTextNode(node, parentPath, depth) {
  if (node.type !== "TEXT") return null;

  try {
    // Safely extract font information
    let fontFamily = "";
    let fontStyle = "";

    if (node.fontName) {
      if (typeof node.fontName === "object") {
        if ("family" in node.fontName) fontFamily = node.fontName.family;
        if ("style" in node.fontName) fontStyle = node.fontName.style;
      }
    }

    // Create a safe representation of the text node
    const safeTextNode = {
      id: node.id,
      name: node.name || "Text",
      type: node.type,
      characters: node.characters,
      fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
      fontFamily: fontFamily,
      fontStyle: fontStyle,
      x: typeof node.x === "number" ? node.x : 0,
      y: typeof node.y === "number" ? node.y : 0,
      width: typeof node.width === "number" ? node.width : 0,
      height: typeof node.height === "number" ? node.height : 0,
      path: parentPath.join(" > "),
      depth: depth,
    };

    // Highlight the node briefly (optional visual feedback)
    try {
      const originalFills = JSON.parse(JSON.stringify(node.fills));
      node.fills = [
        {
          type: "SOLID",
          color: { r: 1, g: 0.5, b: 0 },
          opacity: 0.3,
        },
      ];

      // Brief delay for the highlight to be visible
      await delay(100);

      try {
        node.fills = originalFills;
      } catch (err) {
        console.error("Error resetting fills:", err);
      }
    } catch (highlightErr) {
      console.error("Error highlighting text node:", highlightErr);
      // Continue anyway, highlighting is just visual feedback
    }

    return safeTextNode;
  } catch (nodeErr) {
    console.error("Error processing text node:", nodeErr);
    return null;
  }
}

// A delay function that returns a promise
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep the original findTextNodes for backward compatibility
async function findTextNodes(node, parentPath = [], depth = 0, textNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Get the path to this node including its name
  const nodePath = [...parentPath, node.name || `Unnamed ${node.type}`];

  if (node.type === "TEXT") {
    try {
      // Safely extract font information to avoid Symbol serialization issues
      let fontFamily = "";
      let fontStyle = "";

      if (node.fontName) {
        if (typeof node.fontName === "object") {
          if ("family" in node.fontName) fontFamily = node.fontName.family;
          if ("style" in node.fontName) fontStyle = node.fontName.style;
        }
      }

      // Create a safe representation of the text node with only serializable properties
      const safeTextNode = {
        id: node.id,
        name: node.name || "Text",
        type: node.type,
        characters: node.characters,
        fontSize: typeof node.fontSize === "number" ? node.fontSize : 0,
        fontFamily: fontFamily,
        fontStyle: fontStyle,
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
        path: nodePath.join(" > "),
        depth: depth,
      };

      // Only highlight the node if it's not being done via API
      try {
        // Safe way to create a temporary highlight without causing serialization issues
        const originalFills = JSON.parse(JSON.stringify(node.fills));
        node.fills = [
          {
            type: "SOLID",
            color: { r: 1, g: 0.5, b: 0 },
            opacity: 0.3,
          },
        ];

        // Promise-based delay instead of setTimeout
        await delay(500);

        try {
          node.fills = originalFills;
        } catch (err) {
          console.error("Error resetting fills:", err);
        }
      } catch (highlightErr) {
        console.error("Error highlighting text node:", highlightErr);
        // Continue anyway, highlighting is just visual feedback
      }

      textNodes.push(safeTextNode);
    } catch (nodeErr) {
      console.error("Error processing text node:", nodeErr);
      // Skip this node but continue with others
    }
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findTextNodes(child, nodePath, depth + 1, textNodes);
    }
  }
}

// Replace text in a specific node
async function setMultipleTextContents(params) {
  const { nodeId, text } = params || {};
  const commandId = params.commandId || generateCommandId();

  if (!nodeId || !text || !Array.isArray(text)) {
    const errorMsg = "Missing required parameters: nodeId and text array";

    // Send error progress update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );

    throw new Error(errorMsg);
  }

  console.log(
    `Starting text replacement for node: ${nodeId} with ${text.length} text replacements`
  );

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "started",
    0,
    text.length,
    0,
    `Starting text replacement for ${text.length} nodes`,
    { totalReplacements: text.length }
  );

  // Define the results array and counters
  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Split text replacements into chunks of 5
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${text.length} replacements into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "in_progress",
    5, // 5% progress for planning phase
    text.length,
    0,
    `Preparing to replace text in ${text.length} nodes using ${chunks.length} chunks`,
    {
      totalReplacements: text.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${
        chunk.length
      } replacements`
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Processing text replacements chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      }
    );

    // Process replacements within a chunk in parallel
    const chunkPromises = chunk.map(async (replacement) => {
      if (!replacement.nodeId || replacement.text === undefined) {
        console.error(`Missing nodeId or text for replacement`);
        return {
          success: false,
          nodeId: replacement.nodeId || "unknown",
          error: "Missing nodeId or text in replacement entry",
        };
      }

      try {
        console.log(
          `Attempting to replace text in node: ${replacement.nodeId}`
        );

        // Get the text node to update (just to check it exists and get original text)
        const textNode = await figma.getNodeByIdAsync(replacement.nodeId);

        if (!textNode) {
          console.error(`Text node not found: ${replacement.nodeId}`);
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node not found: ${replacement.nodeId}`,
          };
        }

        if (textNode.type !== "TEXT") {
          console.error(
            `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`
          );
          return {
            success: false,
            nodeId: replacement.nodeId,
            error: `Node is not a text node: ${replacement.nodeId} (type: ${textNode.type})`,
          };
        }

        // Save original text for the result
        const originalText = textNode.characters;
        console.log(`Original text: "${originalText}"`);
        console.log(`Will translate to: "${replacement.text}"`);

        // Highlight the node before changing text
        let originalFills;
        try {
          // Save original fills for restoration later
          originalFills = JSON.parse(JSON.stringify(textNode.fills));
          // Apply highlight color (orange with 30% opacity)
          textNode.fills = [
            {
              type: "SOLID",
              color: { r: 1, g: 0.5, b: 0 },
              opacity: 0.3,
            },
          ];
        } catch (highlightErr) {
          console.error(
            `Error highlighting text node: ${highlightErr.message}`
          );
          // Continue anyway, highlighting is just visual feedback
        }

        // Use the existing setTextContent function to handle font loading and text setting
        await setTextContent({
          nodeId: replacement.nodeId,
          text: replacement.text,
        });

        // Keep highlight for a moment after text change, then restore original fills
        if (originalFills) {
          try {
            // Use delay function for consistent timing
            await delay(500);
            textNode.fills = originalFills;
          } catch (restoreErr) {
            console.error(`Error restoring fills: ${restoreErr.message}`);
          }
        }

        console.log(
          `Successfully replaced text in node: ${replacement.nodeId}`
        );
        return {
          success: true,
          nodeId: replacement.nodeId,
          originalText: originalText,
          translatedText: replacement.text,
        };
      } catch (error) {
        console.error(
          `Error replacing text in node ${replacement.nodeId}: ${error.message}`
        );
        return {
          success: false,
          nodeId: replacement.nodeId,
          error: `Error applying replacement: ${error.message}`,
        };
      }
    });

    // Wait for all replacements in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update with partial results
    sendProgressUpdate(
      commandId,
      "set_multiple_text_contents",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90), // 5-95% for processing
      text.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${
        chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      }
    );

    // Add a small delay between chunks to avoid overloading Figma
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks to avoid overloading Figma...");
      await delay(1000); // 1 second delay between chunks
    }
  }

  console.log(
    `Replacement complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "set_multiple_text_contents",
    "completed",
    100,
    text.length,
    successCount + failureCount,
    `Text replacement complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalReplacements: text.length,
      replacementsApplied: successCount,
      replacementsFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    }
  );

  return {
    success: successCount > 0,
    nodeId: nodeId,
    replacementsApplied: successCount,
    replacementsFailed: failureCount,
    totalReplacements: text.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

// Function to generate simple UUIDs for command IDs
function generateCommandId() {
  return (
    "cmd_" +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

async function getAnnotations(params) {
  try {
    const { nodeId, includeCategories = true } = params;

    // Get categories first if needed
    let categoriesMap = {};
    if (includeCategories) {
      const categories = await figma.annotations.getAnnotationCategoriesAsync();
      categoriesMap = categories.reduce((map, category) => {
        map[category.id] = {
          id: category.id,
          label: category.label,
          color: category.color,
          isPreset: category.isPreset,
        };
        return map;
      }, {});
    }

    if (nodeId) {
      // Get annotations for a specific node
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }

      if (!("annotations" in node)) {
        throw new Error(`Node type ${node.type} does not support annotations`);
      }

      const result = {
        nodeId: node.id,
        name: node.name,
        annotations: node.annotations || [],
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    } else {
      // Get all annotations in the current page
      const annotations = [];
      const processNode = async (node) => {
        if (
          "annotations" in node &&
          node.annotations &&
          node.annotations.length > 0
        ) {
          annotations.push({
            nodeId: node.id,
            name: node.name,
            annotations: node.annotations,
          });
        }
        if ("children" in node) {
          for (const child of node.children) {
            await processNode(child);
          }
        }
      };

      // Start from current page
      await processNode(figma.currentPage);

      const result = {
        annotatedNodes: annotations,
      };

      if (includeCategories) {
        result.categories = Object.values(categoriesMap);
      }

      return result;
    }
  } catch (error) {
    console.error("Error in getAnnotations:", error);
    throw error;
  }
}

async function setAnnotation(params) {
  try {
    console.log("=== setAnnotation Debug Start ===");
    console.log("Input params:", JSON.stringify(params, null, 2));

    const { nodeId, annotationId, labelMarkdown, categoryId, properties } =
      params;

    // Validate required parameters
    if (!nodeId) {
      console.error("Validation failed: Missing nodeId");
      return { success: false, error: "Missing nodeId" };
    }

    if (!labelMarkdown) {
      console.error("Validation failed: Missing labelMarkdown");
      return { success: false, error: "Missing labelMarkdown" };
    }

    console.log("Attempting to get node:", nodeId);
    // Get and validate node
    const node = await figma.getNodeByIdAsync(nodeId);
    console.log("Node lookup result:", {
      id: nodeId,
      found: !!node,
      type: node ? node.type : undefined,
      name: node ? node.name : undefined,
      hasAnnotations: node ? "annotations" in node : false,
    });

    if (!node) {
      console.error("Node lookup failed:", nodeId);
      return { success: false, error: `Node not found: ${nodeId}` };
    }

    // Validate node supports annotations
    if (!("annotations" in node)) {
      console.error("Node annotation support check failed:", {
        nodeType: node.type,
        nodeId: node.id,
      });
      return {
        success: false,
        error: `Node type ${node.type} does not support annotations`,
      };
    }

    // Create the annotation object
    const newAnnotation = {
      labelMarkdown,
    };

    // Validate and add categoryId if provided
    if (categoryId) {
      console.log("Adding categoryId to annotation:", categoryId);
      newAnnotation.categoryId = categoryId;
    }

    // Validate and add properties if provided
    if (properties && Array.isArray(properties) && properties.length > 0) {
      console.log(
        "Adding properties to annotation:",
        JSON.stringify(properties, null, 2)
      );
      newAnnotation.properties = properties;
    }

    // Log current annotations before update
    console.log("Current node annotations:", node.annotations);

    // Overwrite annotations
    console.log(
      "Setting new annotation:",
      JSON.stringify(newAnnotation, null, 2)
    );
    node.annotations = [newAnnotation];

    // Verify the update
    console.log("Updated node annotations:", node.annotations);
    console.log("=== setAnnotation Debug End ===");

    return {
      success: true,
      nodeId: node.id,
      name: node.name,
      annotations: node.annotations,
    };
  } catch (error) {
    console.error("=== setAnnotation Error ===");
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      params: JSON.stringify(params, null, 2),
    });
    return { success: false, error: error.message };
  }
}

/**
 * Scan for nodes with specific types within a node
 * @param {Object} params - Parameters object
 * @param {string} params.nodeId - ID of the node to scan within
 * @param {Array<string>} params.types - Array of node types to find (e.g. ['COMPONENT', 'FRAME'])
 * @returns {Object} - Object containing found nodes
 */
async function scanNodesByTypes(params) {
  console.log(`Starting to scan nodes by types from node ID: ${params.nodeId}`);
  const { nodeId, types = [] } = params || {};

  if (!types || types.length === 0) {
    throw new Error("No types specified to search for");
  }

  const node = await figma.getNodeByIdAsync(nodeId);

  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Simple implementation without chunking
  const matchingNodes = [];

  // Send a single progress update to notify start
  const commandId = generateCommandId();
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "started",
    0,
    1,
    0,
    `Starting scan of node "${node.name || nodeId}" for types: ${types.join(
      ", "
    )}`,
    null
  );

  // Recursively find nodes with specified types
  await findNodesByTypes(node, types, matchingNodes);

  // Send completion update
  sendProgressUpdate(
    commandId,
    "scan_nodes_by_types",
    "completed",
    100,
    matchingNodes.length,
    matchingNodes.length,
    `Scan complete. Found ${matchingNodes.length} matching nodes.`,
    { matchingNodes }
  );

  return {
    success: true,
    message: `Found ${matchingNodes.length} matching nodes.`,
    count: matchingNodes.length,
    matchingNodes: matchingNodes,
    searchedTypes: types,
  };
}

/**
 * Helper function to recursively find nodes with specific types
 * @param {SceneNode} node - The root node to start searching from
 * @param {Array<string>} types - Array of node types to find
 * @param {Array} matchingNodes - Array to store found nodes
 */
async function findNodesByTypes(node, types, matchingNodes = []) {
  // Skip invisible nodes
  if (node.visible === false) return;

  // Check if this node is one of the specified types
  if (types.includes(node.type)) {
    // Create a minimal representation with just ID, type and bbox
    matchingNodes.push({
      id: node.id,
      name: node.name || `Unnamed ${node.type}`,
      type: node.type,
      // Basic bounding box info
      bbox: {
        x: typeof node.x === "number" ? node.x : 0,
        y: typeof node.y === "number" ? node.y : 0,
        width: typeof node.width === "number" ? node.width : 0,
        height: typeof node.height === "number" ? node.height : 0,
      },
    });
  }

  // Recursively process children of container nodes
  if ("children" in node) {
    for (const child of node.children) {
      await findNodesByTypes(child, types, matchingNodes);
    }
  }
}

// Set multiple annotations with async progress updates
async function setMultipleAnnotations(params) {
  console.log("=== setMultipleAnnotations Debug Start ===");
  console.log("Input params:", JSON.stringify(params, null, 2));

  const { nodeId, annotations } = params;

  if (!annotations || annotations.length === 0) {
    console.error("Validation failed: No annotations provided");
    return { success: false, error: "No annotations provided" };
  }

  console.log(
    `Processing ${annotations.length} annotations for node ${nodeId}`
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process annotations sequentially
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];
    console.log(
      `\nProcessing annotation ${i + 1}/${annotations.length}:`,
      JSON.stringify(annotation, null, 2)
    );

    try {
      console.log("Calling setAnnotation with params:", {
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      const result = await setAnnotation({
        nodeId: annotation.nodeId,
        labelMarkdown: annotation.labelMarkdown,
        categoryId: annotation.categoryId,
        properties: annotation.properties,
      });

      console.log("setAnnotation result:", JSON.stringify(result, null, 2));

      if (result.success) {
        successCount++;
        results.push({ success: true, nodeId: annotation.nodeId });
        console.log(`✓ Annotation ${i + 1} applied successfully`);
      } else {
        failureCount++;
        results.push({
          success: false,
          nodeId: annotation.nodeId,
          error: result.error,
        });
        console.error(`✗ Annotation ${i + 1} failed:`, result.error);
      }
    } catch (error) {
      failureCount++;
      const errorResult = {
        success: false,
        nodeId: annotation.nodeId,
        error: error.message,
      };
      results.push(errorResult);
      console.error(`✗ Annotation ${i + 1} failed with error:`, error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
      });
    }
  }

  const summary = {
    success: successCount > 0,
    annotationsApplied: successCount,
    annotationsFailed: failureCount,
    totalAnnotations: annotations.length,
    results: results,
  };

  console.log("\n=== setMultipleAnnotations Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== setMultipleAnnotations Debug End ===");

  return summary;
}

async function deleteMultipleNodes(params) {
  const { nodeIds } = params || {};
  const commandId = generateCommandId();

  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    const errorMsg = "Missing or invalid nodeIds parameter";
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "error",
      0,
      0,
      0,
      errorMsg,
      { error: errorMsg }
    );
    throw new Error(errorMsg);
  }

  console.log(`Starting deletion of ${nodeIds.length} nodes`);

  // Send started progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "started",
    0,
    nodeIds.length,
    0,
    `Starting deletion of ${nodeIds.length} nodes`,
    { totalNodes: nodeIds.length }
  );

  const results = [];
  let successCount = 0;
  let failureCount = 0;

  // Process nodes in chunks of 5 to avoid overwhelming Figma
  const CHUNK_SIZE = 5;
  const chunks = [];

  for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
    chunks.push(nodeIds.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Split ${nodeIds.length} deletions into ${chunks.length} chunks`);

  // Send chunking info update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "in_progress",
    5,
    nodeIds.length,
    0,
    `Preparing to delete ${nodeIds.length} nodes using ${chunks.length} chunks`,
    {
      totalNodes: nodeIds.length,
      chunks: chunks.length,
      chunkSize: CHUNK_SIZE,
    }
  );

  // Process each chunk sequentially
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `Processing chunk ${chunkIndex + 1}/${chunks.length} with ${
        chunk.length
      } nodes`
    );

    // Send chunk processing start update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + (chunkIndex / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Processing deletion chunk ${chunkIndex + 1}/${chunks.length}`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
      }
    );

    // Process deletions within a chunk in parallel
    const chunkPromises = chunk.map(async (nodeId) => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node) {
          console.error(`Node not found: ${nodeId}`);
          return {
            success: false,
            nodeId: nodeId,
            error: `Node not found: ${nodeId}`,
          };
        }

        // Save node info before deleting
        const nodeInfo = {
          id: node.id,
          name: node.name,
          type: node.type,
        };

        // Delete the node
        node.remove();

        console.log(`Successfully deleted node: ${nodeId}`);
        return {
          success: true,
          nodeId: nodeId,
          nodeInfo: nodeInfo,
        };
      } catch (error) {
        console.error(`Error deleting node ${nodeId}: ${error.message}`);
        return {
          success: false,
          nodeId: nodeId,
          error: error.message,
        };
      }
    });

    // Wait for all deletions in this chunk to complete
    const chunkResults = await Promise.all(chunkPromises);

    // Process results for this chunk
    chunkResults.forEach((result) => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      results.push(result);
    });

    // Send chunk processing complete update
    sendProgressUpdate(
      commandId,
      "delete_multiple_nodes",
      "in_progress",
      Math.round(5 + ((chunkIndex + 1) / chunks.length) * 90),
      nodeIds.length,
      successCount + failureCount,
      `Completed chunk ${chunkIndex + 1}/${
        chunks.length
      }. ${successCount} successful, ${failureCount} failed so far.`,
      {
        currentChunk: chunkIndex + 1,
        totalChunks: chunks.length,
        successCount,
        failureCount,
        chunkResults: chunkResults,
      }
    );

    // Add a small delay between chunks
    if (chunkIndex < chunks.length - 1) {
      console.log("Pausing between chunks...");
      await delay(1000);
    }
  }

  console.log(
    `Deletion complete: ${successCount} successful, ${failureCount} failed`
  );

  // Send completed progress update
  sendProgressUpdate(
    commandId,
    "delete_multiple_nodes",
    "completed",
    100,
    nodeIds.length,
    successCount + failureCount,
    `Node deletion complete: ${successCount} successful, ${failureCount} failed`,
    {
      totalNodes: nodeIds.length,
      nodesDeleted: successCount,
      nodesFailed: failureCount,
      completedInChunks: chunks.length,
      results: results,
    }
  );

  return {
    success: successCount > 0,
    nodesDeleted: successCount,
    nodesFailed: failureCount,
    totalNodes: nodeIds.length,
    results: results,
    completedInChunks: chunks.length,
    commandId,
  };
}

async function setLayoutMode(params) {
  const { nodeId, layoutMode = "NONE", layoutWrap = "NO_WRAP" } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports layoutMode
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support layoutMode`);
  }

  // Set layout mode
  node.layoutMode = layoutMode;

  // Set layoutWrap if applicable
  if (layoutMode !== "NONE") {
    node.layoutWrap = layoutWrap;
  }

  return {
    id: node.id,
    name: node.name,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
  };
}

async function setPadding(params) {
  const { nodeId, paddingTop, paddingRight, paddingBottom, paddingLeft } =
    params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports padding
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support padding`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Padding can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Set padding values if provided
  if (paddingTop !== undefined) node.paddingTop = paddingTop;
  if (paddingRight !== undefined) node.paddingRight = paddingRight;
  if (paddingBottom !== undefined) node.paddingBottom = paddingBottom;
  if (paddingLeft !== undefined) node.paddingLeft = paddingLeft;

  return {
    id: node.id,
    name: node.name,
    paddingTop: node.paddingTop,
    paddingRight: node.paddingRight,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
  };
}

async function setAxisAlign(params) {
  const { nodeId, primaryAxisAlignItems, counterAxisAlignItems } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports axis alignment
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support axis alignment`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Axis alignment can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Validate and set primaryAxisAlignItems if provided
  if (primaryAxisAlignItems !== undefined) {
    if (
      !["MIN", "MAX", "CENTER", "SPACE_BETWEEN"].includes(primaryAxisAlignItems)
    ) {
      throw new Error(
        "Invalid primaryAxisAlignItems value. Must be one of: MIN, MAX, CENTER, SPACE_BETWEEN"
      );
    }
    node.primaryAxisAlignItems = primaryAxisAlignItems;
  }

  // Validate and set counterAxisAlignItems if provided
  if (counterAxisAlignItems !== undefined) {
    if (!["MIN", "MAX", "CENTER", "BASELINE"].includes(counterAxisAlignItems)) {
      throw new Error(
        "Invalid counterAxisAlignItems value. Must be one of: MIN, MAX, CENTER, BASELINE"
      );
    }
    // BASELINE is only valid for horizontal layout
    if (
      counterAxisAlignItems === "BASELINE" &&
      node.layoutMode !== "HORIZONTAL"
    ) {
      throw new Error(
        "BASELINE alignment is only valid for horizontal auto-layout frames"
      );
    }
    node.counterAxisAlignItems = counterAxisAlignItems;
  }

  return {
    id: node.id,
    name: node.name,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    layoutMode: node.layoutMode,
  };
}

async function setLayoutSizing(params) {
  const { nodeId, layoutSizingHorizontal, layoutSizingVertical } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports layout sizing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support layout sizing`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Layout sizing can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Validate and set layoutSizingHorizontal if provided
  if (layoutSizingHorizontal !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingHorizontal)) {
      throw new Error(
        "Invalid layoutSizingHorizontal value. Must be one of: FIXED, HUG, FILL"
      );
    }
    // HUG is only valid on auto-layout frames and text nodes
    if (
      layoutSizingHorizontal === "HUG" &&
      !["FRAME", "TEXT"].includes(node.type)
    ) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames and text nodes"
      );
    }
    // FILL is only valid on auto-layout children
    if (
      layoutSizingHorizontal === "FILL" &&
      (!node.parent || node.parent.layoutMode === "NONE")
    ) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
    node.layoutSizingHorizontal = layoutSizingHorizontal;
  }

  // Validate and set layoutSizingVertical if provided
  if (layoutSizingVertical !== undefined) {
    if (!["FIXED", "HUG", "FILL"].includes(layoutSizingVertical)) {
      throw new Error(
        "Invalid layoutSizingVertical value. Must be one of: FIXED, HUG, FILL"
      );
    }
    // HUG is only valid on auto-layout frames and text nodes
    if (
      layoutSizingVertical === "HUG" &&
      !["FRAME", "TEXT"].includes(node.type)
    ) {
      throw new Error(
        "HUG sizing is only valid on auto-layout frames and text nodes"
      );
    }
    // FILL is only valid on auto-layout children
    if (
      layoutSizingVertical === "FILL" &&
      (!node.parent || node.parent.layoutMode === "NONE")
    ) {
      throw new Error("FILL sizing is only valid on auto-layout children");
    }
    node.layoutSizingVertical = layoutSizingVertical;
  }

  return {
    id: node.id,
    name: node.name,
    layoutSizingHorizontal: node.layoutSizingHorizontal,
    layoutSizingVertical: node.layoutSizingVertical,
    layoutMode: node.layoutMode,
  };
}

async function setItemSpacing(params) {
  const { nodeId, itemSpacing } = params || {};

  // Get the target node
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) {
    throw new Error(`Node with ID ${nodeId} not found`);
  }

  // Check if node is a frame or component that supports item spacing
  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type ${node.type} does not support item spacing`);
  }

  // Check if the node has auto-layout enabled
  if (node.layoutMode === "NONE") {
    throw new Error(
      "Item spacing can only be set on auto-layout frames (layoutMode must not be NONE)"
    );
  }

  // Set item spacing
  if (itemSpacing !== undefined) {
    if (typeof itemSpacing !== "number") {
      throw new Error("Item spacing must be a number");
    }
    node.itemSpacing = itemSpacing;
  }

  return {
    id: node.id,
    name: node.name,
    itemSpacing: node.itemSpacing,
    layoutMode: node.layoutMode,
  };
}

async function analyzeSelection() {
  console.log('🔍 Starting analyzeSelection');
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    console.log('⚠️ No element selected');
    return { error: 'No element selected' };
  }

  if (selection.length > 1) {
    console.log('⚠️ Multiple elements selected');
    return { error: 'Multiple elements selected. Please select only one element.' };
  }

  const node = selection[0];
  console.log('✅ Selected node:', node.name, node.id);
  
  // Initialize statistics
  let stats = {
    totalLayers: 0,
    hiddenLayers: 0,
    lockedLayers: 0,
    topLevelLayers: 0
  };

  // Function to recursively count layers
  function countLayers(node) {
    stats.totalLayers++;
    console.log(`📊 Processing node: ${node.name} (${node.id}), visible: ${node.visible}`);
    
    if (!node.visible) {
      stats.hiddenLayers++;
      console.log(`🔍 Found hidden layer: ${node.name} (${node.id})`);
    }
    if (node.locked) {
      stats.lockedLayers++;
      console.log(`🔒 Found locked layer: ${node.name} (${node.id})`);
    }

    if ('children' in node) {
      if (node.id === selection[0].id) {
        stats.topLevelLayers = node.children.length;
        console.log(`👶 Top level children count: ${node.children.length}`);
      }
      console.log(`📂 Processing ${node.children.length} children of node ${node.name}`);
      node.children.forEach(child => countLayers(child));
    }
  }

  // Count all layers
  countLayers(node);
  console.log('📈 Final statistics:', stats);

  // Format the analysis as a simple string
  let analysisText = [
    `Selected Element: ${node.name}`,
    `Total Layers: ${stats.totalLayers}`,
    stats.hiddenLayers > 0 ? `Hidden Layers: ${stats.hiddenLayers}` : null,
    stats.lockedLayers > 0 ? `Locked Layers: ${stats.lockedLayers}` : null,
    stats.topLevelLayers > 0 ? `Direct Children: ${stats.topLevelLayers}` : null
  ].filter(line => line !== null).join('\n');

  const result = {
    message: analysisText,
    raw: filterFigmaNode(node),
    statistics: stats
  };
  console.log('✅ Analysis complete:', result);
  return result;
}

async function convertToFrame(params = {}) {
  console.log('🎯 Converting selection to frame...', params);
  
  // Get current selection
  const selection = figma.currentPage.selection;
  console.log(`📝 Current selection: ${selection.length} items`);
  
  if (selection.length === 0) {
    throw new Error('Please select an element first');
  }

  const node = selection[0];
  console.log('🔍 Selected node:', {
    id: node.id,
    type: node.type,
    name: node.name,
    width: node.width,
    height: node.height
  });

  // Create new auto-layout frame
  console.log('📦 Creating new auto-layout frame...');
  const frame = figma.createFrame();
  frame.name = 'Sprite Frame';
  
  // Make it square based on the larger dimension
  const maxSize = Math.max(node.width, node.height);
  console.log(`📏 Setting frame size to ${maxSize}x${maxSize}`);
  frame.resize(maxSize, maxSize);
  
  // Set up auto-layout
  console.log('⚙️ Configuring auto-layout properties...');
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisAlignItems = 'CENTER';
  frame.counterAxisAlignItems = 'CENTER';
  frame.layoutSizingHorizontal = 'FIXED';
  frame.layoutSizingVertical = 'FIXED';
  
  // Position frame at the center of the viewport
  const viewport = figma.viewport;
  frame.x = viewport.center.x - (maxSize / 2);
  frame.y = viewport.center.y - (maxSize / 2);
  
  // Move the selected node into the frame
  console.log('➡️ Moving node into frame...');
  frame.appendChild(node);

  // Set up pixel grid with specified or default size
  const gridSize = params.gridSize || 8; // Default to 8 if not specified
  console.log(`📏 Setting up ${gridSize}x${gridSize} pixel grid...`);
  const grid = {
    pattern: 'GRID',
    sectionSize: gridSize,
    visible: true,
    color: { r: 1, g: 0, b: 0, a: 1 } // 100% red
  };
  frame.layoutGrids = [grid];

  // Select the new frame and ensure it's visible in the viewport
  figma.currentPage.selection = [frame];
  
  // Zoom to a comfortable level (80% of viewport)
  const padding = 100; // Add padding around the frame
  figma.viewport.scrollAndZoomIntoView([frame]);
  
  // Additional zoom adjustment for better visibility
  const targetZoom = Math.min(
    (viewport.bounds.width * 0.8) / frame.width,
    (viewport.bounds.height * 0.8) / frame.height
  );
  figma.viewport.zoom = targetZoom;
  
  console.log('✨ Frame created and centered in viewport');
  return {
    success: true,
    frame: {
      id: frame.id,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      gridSize: gridSize
    }
  };
}

async function createGridFrame(params) {
  console.log('🎯 Creating grid frame...');
  
  try {
    // Get viewport center
    const viewport = figma.viewport;
    console.log('📍 Viewport:', {
      x: viewport.center.x,
      y: viewport.center.y,
      zoom: viewport.zoom
    });

    // Create frame
    console.log('📦 Creating frame with dimensions:', {
      width: params.width || 1200,
      height: params.height || 900
    });
    
    const frame = figma.createFrame();
    frame.name = 'Grid Frame';
    frame.resize(
      params.width || 1200,
      params.height || 900
    );

    // Position frame at viewport center
    const centerX = viewport.center.x - (frame.width / 2);
    const centerY = viewport.center.y - (frame.height / 2);
    console.log('🎯 Positioning frame at center:', { x: centerX, y: centerY });
    
    frame.x = centerX;
    frame.y = centerY;

    // Set up grid
    const gridSize = params.gridSize || 8;
    console.log('📏 Setting up grid with size:', gridSize);
    
    const grid = {
      pattern: 'GRID',
      sectionSize: gridSize,
      visible: true,
      color: { r: 1, g: 0, b: 0, a: 1 } // 100% red
    };
    frame.layoutGrids = [grid];

    // Enable snapping and set zoom
    console.log('🔒 Configuring viewport and snapping');
    figma.viewport.zoom = 1; // Reset zoom for better visibility
    frame.constraints = { horizontal: 'CENTER', vertical: 'CENTER' };

    // Scroll viewport to frame
    figma.viewport.scrollAndZoomIntoView([frame]);

    // Select the new frame
    figma.currentPage.selection = [frame];
    console.log('✅ Grid frame created successfully');

    return {
      success: true,
      frame: {
        id: frame.id,
        name: frame.name,
        width: frame.width,
        height: frame.height,
        gridSize: gridSize
      }
    };

  } catch (error) {
    console.error('❌ Error creating grid frame:', error);
    throw new Error(`Failed to create grid frame: ${error.message}`);
  }
}

async function snapToGrid(params) {
  console.log('🎯 Starting grid snap operation...');
  
  try {
    const selection = figma.currentPage.selection;
    console.log(`📝 Current selection: ${selection.length} items`);
    
    if (selection.length === 0) {
      throw new Error('Please select elements to snap to grid');
    }

    const gridSize = params.gridSize || 32;
    console.log('📏 Grid size:', gridSize);

    const snappedNodes = [];
    
    for (const node of selection) {
      console.log('🔄 Processing node:', node.name);
      
      // Calculate nearest grid positions
      const newX = Math.round(node.x / gridSize) * gridSize;
      const newY = Math.round(node.y / gridSize) * gridSize;
      
      console.log('📍 Snapping coordinates:', {
        from: { x: node.x, y: node.y },
        to: { x: newX, y: newY }
      });

      // Move node to snapped position
      node.x = newX;
      node.y = newY;
      
      snappedNodes.push({
        id: node.id,
        name: node.name,
        newPosition: { x: newX, y: newY }
      });
    }

    console.log('✅ Grid snap complete');
    return {
      success: true,
      snappedCount: selection.length,
      nodes: snappedNodes
    };

  } catch (error) {
    console.error('❌ Error snapping to grid:', error);
    throw new Error(`Failed to snap to grid: ${error.message}`);
  }
}

async function exportPhaserMap(params) {
  console.log('🗺️ Exporting Phaser map with params:', params);

  try {
    const { tileWidth, tileHeight, tilesetName, mapName } = params;

    if (!tileWidth || !tileHeight || !tilesetName || !mapName) {
      throw new Error('Missing required parameters');
    }

    // Get current selection
    const selection = figma.currentPage.selection;
    if (!selection || selection.length === 0) {
      throw new Error('No selection found');
    }

    // Validate selection is a frame
    const frame = selection[0];
    if (frame.type !== 'FRAME') {
      throw new Error('Selected node must be a frame');
    }

    // Calculate grid dimensions
    const cols = Math.floor(frame.width / tileWidth);
    const rows = Math.floor(frame.height / tileHeight);

    console.log(`📐 Grid dimensions: ${cols}x${rows}`);

    // Initialize empty tilemap data
    const tilemapData = {
      type: 'map',
      version: 1,
      width: cols,
      height: rows,
      tilewidth: tileWidth,
      tileheight: tileHeight,
      orientation: 'orthogonal',
      renderorder: 'right-down',
      infinite: false,
      nextlayerid: 2,
      nextobjectid: 1,
      properties: [],
      tilesets: [
        {
          name: tilesetName,
          firstgid: 1,
          tilewidth: tileWidth,
          tileheight: tileHeight,
          spacing: 0,
          margin: 0,
          image: `${tilesetName}.png`,
          imagewidth: frame.width,
          imageheight: frame.height,
          tilecount: cols * rows,
          columns: cols
        }
      ],
      layers: [
        {
          type: 'tilelayer',
          name: 'Tile Layer 1',
          x: 0,
          y: 0,
          width: cols,
          height: rows,
          opacity: 1,
          visible: true,
          data: []
        }
      ]
    };

    // Fill layer data with tile indices (1-based)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const tileIndex = y * cols + x + 1; // 1-based indexing
        tilemapData.layers[0].data.push(tileIndex);
      }
    }

    // Create the terminal-style frame
    const terminalFrame = figma.createFrame();
    terminalFrame.name = `${mapName}.json`;
    
    // Position in the center of the viewport
    const { x, y } = figma.viewport.center;
    
    // Set frame properties for terminal look
    terminalFrame.layoutMode = 'VERTICAL';
    terminalFrame.primaryAxisSizingMode = 'AUTO';
    terminalFrame.counterAxisSizingMode = 'AUTO';
    terminalFrame.fills = [{ type: 'SOLID', color: { r: 0.133, g: 0.133, b: 0.133 } }]; // Dark gray background
    terminalFrame.paddingLeft = 24;
    terminalFrame.paddingRight = 24;
    terminalFrame.paddingTop = 24;
    terminalFrame.paddingBottom = 24;
    terminalFrame.cornerRadius = 12;
    
    // Add terminal header
    const headerFrame = figma.createFrame();
    headerFrame.name = 'Terminal Header';
    headerFrame.layoutMode = 'HORIZONTAL';
    headerFrame.primaryAxisSizingMode = 'FIXED';  // Changed from FILL to FIXED
    headerFrame.counterAxisSizingMode = 'AUTO';
    headerFrame.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }]; // Slightly lighter gray
    headerFrame.paddingLeft = 12;
    headerFrame.paddingRight = 12;
    headerFrame.paddingTop = 8;
    headerFrame.paddingBottom = 8;
    headerFrame.cornerRadius = 8;
    headerFrame.resize(400, headerFrame.height); // Set a fixed width for the header
    
    // Create header text and load fonts first
    const headerText = figma.createText();
    const textNode = figma.createText();

    // Load all required fonts first
    console.log('Loading fonts...');
    await Promise.all([
      figma.loadFontAsync({ family: "Inter", style: "Medium" }),
      figma.loadFontAsync({ family: "Inter", style: "Regular" })
    ]);

    // Try to load additional monospace fonts
    let monospaceFontLoaded = false;
    try {
      await figma.loadFontAsync({ family: "JetBrains Mono", style: "Regular" });
      textNode.fontName = { family: "JetBrains Mono", style: "Regular" };
      monospaceFontLoaded = true;
    } catch (e1) {
      try {
        await figma.loadFontAsync({ family: "Consolas", style: "Regular" });
        textNode.fontName = { family: "Consolas", style: "Regular" };
        monospaceFontLoaded = true;
      } catch (e2) {
        console.log('Falling back to Inter font');
        textNode.fontName = { family: "Inter", style: "Regular" };
      }
    }

    // Now set up the header
    headerText.fontName = { family: "Inter", style: "Medium" };
    headerText.characters = `${mapName}.json`;
    headerText.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }]; // Light gray text
    
    // Add header elements
    headerFrame.appendChild(headerText);
    terminalFrame.appendChild(headerFrame);

    // Add the main text content
    terminalFrame.appendChild(textNode);
    
    // Format JSON with proper indentation and add command prompt style
    const formattedJson = JSON.stringify(tilemapData, null, 2);
    textNode.characters = `$ cat ${mapName}.json\n${formattedJson}`;
    
    // Style the text
    textNode.fontSize = 12;
    textNode.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }]; // Light gray text
    textNode.lineHeight = { value: 150, unit: 'PERCENT' }; // Increase line height for better readability

    // Add drop shadow to terminal window
    terminalFrame.effects = [
      {
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.3 },
        offset: { x: 0, y: 4 },
        radius: 16,
        spread: 0,
        visible: true,
        blendMode: 'NORMAL'
      }
    ];

    // Position the frame in the center of the viewport
    terminalFrame.x = x - (terminalFrame.width / 2);
    terminalFrame.y = y - (terminalFrame.height / 2);

    // Select the frame and zoom to it
    figma.currentPage.selection = [terminalFrame];
    figma.viewport.scrollAndZoomIntoView([terminalFrame]);

    console.log('✅ Tilemap exported successfully');
    figma.notify('Tilemap exported successfully');

    return {
      success: true,
      mapData: tilemapData
    };

  } catch (error) {
    console.error('❌ Error exporting tilemap:', error);
    figma.notify('Error exporting tilemap: ' + error.message, { error: true });
    throw error;
  }
}

// Add the analyze layers handler function
function handleAnalyzeLayers() {
  const selection = figma.currentPage.selection;
  
  // Map selection to include only necessary properties
  const selectionData = selection.map(node => ({
    id: node.id,
    name: node.name,
    type: node.type,
    width: node.width,
    height: node.height,
    characters: node.type === 'TEXT' ? node.characters : undefined,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    children: node.children ? node.children.length : 0
  }));

  // Send the analysis result back to the UI
  figma.ui.postMessage({
    type: 'analyze-result',
    selection: selectionData
  });
}

async function handleExportSelection(msg) {
  try {
    const selection = figma.currentPage.selection;
    
    if (!selection || selection.length === 0) {
      figma.ui.postMessage({
        type: 'export-result',
        success: false,
        error: 'No element selected. Please select an element to export.'
      });
      return;
    }

    const node = selection[0];
    const format = msg.format || 'PNG';
    console.log('Export format requested:', format);

    if (format === 'ZIP') {
      console.log('Preparing PNG export for ZIP');
      
      try {
        // Export as PNG with 2x scale
        const pngExport = await node.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: 2 }
        });
        
        console.log('PNG export successful');

        // Prepare export details
        const details = {
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          count: 1,
          formats: ['PNG'],
          totalBytes: pngExport.length
        };

        // Send success response with PNG export
        figma.ui.postMessage({
          type: 'export-result',
          success: true,
          format: 'ZIP',
          filename: node.name,
          exports: [{
            filename: `${node.name}_2x.png`,
            bytes: pngExport
          }],
          details: details
        });
      } catch (error) {
        console.error('Failed to export PNG:', error);
        figma.ui.postMessage({
          type: 'export-result',
          success: false,
          error: `Failed to export PNG: ${error.message}`
        });
      }
    } else {
      // Handle regular single-format export
      const bytes = await node.exportAsync({
        format: format,
        constraint: { type: 'SCALE', value: 2 }
      });

      figma.ui.postMessage({
        type: 'export-result',
        success: true,
        format: format,
        filename: `${node.name}_2x.${format.toLowerCase()}`,
        bytes: bytes,
        details: {
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          dimensions: `${node.width}x${node.height}`,
          size: `${(bytes.length / 1024).toFixed(2)} KB`
        }
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    figma.ui.postMessage({
      type: 'export-result',
      success: false,
      error: error.message
    });
  }
}

async function createAtlas(params = {}) {
  console.log('🗺️ Creating atlas from selection...', params);
  
  // Get current selection
  const selection = figma.currentPage.selection;
  console.log(`📝 Current selection: ${selection.length} items`);
  
  if (selection.length < 2) {
    throw new Error('Please select at least 2 frames to create an atlas');
  }

  // Validate that all selected items are frames
  const invalidItems = selection.filter(node => node.type !== 'FRAME');
  if (invalidItems.length > 0) {
    throw new Error('All selected items must be frames');
  }

  // Store gridSize param but don't use it for layout
  const gridSize = params.gridSize || 8;
  
  // Create frame objects with original dimensions (no snapping)
  const frames = selection.map(frame => ({
    node: frame,
    width: frame.width,
    height: frame.height,
    x: 0,
    y: 0,
    originalX: frame.x,
    originalY: frame.y
  }));

  // Find the largest frame by area
  const largestFrame = frames.reduce((largest, current) => {
    const currentArea = current.width * current.height;
    const largestArea = largest.width * largest.height;
    return currentArea > largestArea ? current : largest;
  }, frames[0]);

  console.log('📏 Largest frame:', {
    name: largestFrame.node.name,
    width: largestFrame.width,
    height: largestFrame.height,
    position: { x: largestFrame.originalX, y: largestFrame.originalY }
  });

  // Simple shelf-based bin packing algorithm
  let currentX = 0;
  let currentY = 0;
  let shelfHeight = 0;
  let maxWidth = 0;
  let maxHeight = 0;

  // Place each frame using shelf algorithm
  frames.forEach(frame => {
    // If frame doesn't fit on current shelf, start a new shelf
    if (currentX + frame.width > maxWidth) {
      currentX = 0;
      currentY += shelfHeight;
      shelfHeight = 0;
    }

    // Place frame at current position
    frame.x = currentX;
    frame.y = currentY;
    console.log("Placing " + frame.node.name + " at (" + frame.x + "," + frame.y + ")");

    // Update shelf height if this frame is taller
    shelfHeight = Math.max(shelfHeight, frame.height);
    
    // Update atlas bounds
    maxWidth = Math.max(maxWidth, currentX + frame.width);
    maxHeight = Math.max(maxHeight, currentY + frame.height);

    // Move x position for next frame
    currentX += frame.width;
  });

  // Check if atlas exceeds maximum dimensions
  const MAX_ATLAS_SIZE = 2048;
  if (maxWidth > MAX_ATLAS_SIZE || maxHeight > MAX_ATLAS_SIZE) {
    console.error(`❌ Error: Atlas size (${maxWidth}x${maxHeight}) exceeds maximum dimensions of ${MAX_ATLAS_SIZE}x${MAX_ATLAS_SIZE}`);
    throw new Error(`Atlas size (${maxWidth}x${maxHeight}) exceeds maximum dimensions of ${MAX_ATLAS_SIZE}x${MAX_ATLAS_SIZE}`);
  }

  // Create new atlas frame with exact dimensions
  console.log('📦 Creating atlas frame with dimensions:', { width: maxWidth, height: maxHeight });
  const atlas = figma.createFrame();
  atlas.name = 'Sprite Atlas';
  atlas.resize(maxWidth, maxHeight);
  
  // Disable auto-layout for precise positioning
  atlas.layoutMode = 'NONE';
  
  // Position atlas at the same position as the largest frame
  atlas.x = largestFrame.originalX;
  atlas.y = largestFrame.originalY;

  // Add all frames to the atlas at their calculated positions
  console.log('➡️ Adding frames to atlas...');
  frames.forEach(frame => {
    atlas.appendChild(frame.node);
    frame.node.x = frame.x;
    frame.node.y = frame.y;
  });

  // Select the atlas and ensure it's visible in the viewport
  figma.currentPage.selection = [atlas];
  // figma.viewport.scrollAndZoomIntoView([atlas]); // Removed to prevent viewport changes

  // Build frames array for JSON
  const framesArr = frames.map((frame) => ({
    filename: `${frame.node.name}.png`,
    rotated: false,
    trimmed: false,
    sourceSize: {
      w: Math.round(frame.width),
      h: Math.round(frame.height)
    },
    spriteSourceSize: {
      x: 0,
      y: 0,
      w: Math.round(frame.width),
      h: Math.round(frame.height)
    },
    frame: {
      x: Math.round(frame.x),
      y: Math.round(frame.y),
      w: Math.round(frame.width),
      h: Math.round(frame.height)
    }
  }));

  // Texture object
  const textureObj = {
    image: "atlas.png",
    format: "RGBA8888",
    size: {
      w: Math.round(maxWidth),
      h: Math.round(maxHeight)
    },
    scale: 1,
    frames: framesArr
  };

  // Meta object
  const metaObj = {
    app: "http://free-tex-packer.com",
    version: "0.6.5"
  };

  // Final JSON
  const atlasJson = {
    textures: [textureObj],
    meta: metaObj
  };

  // Format JSON with 2-space indentation
  const formattedJson = JSON.stringify(atlasJson, null, 2);
  
  // Log the formatted JSON to console
  console.log('Atlas JSON Data:');
  console.log(formattedJson);

  // Send to UI
  console.log('📤 Sending atlas JSON to UI...');
  figma.ui.postMessage({
    type: "export-atlas-json",
    data: atlasJson
  });

  console.log('✅ Atlas created successfully');
  return {
    success: true,
    atlas: {
      id: atlas.id,
      name: atlas.name,
      width: maxWidth,
      height: maxHeight,
      gridSize: gridSize,
      framesCount: selection.length,
      json: atlasJson
    }
  };
}

async function convertToBasicFrame(params = {}) {
  console.log('🔄 Converting selection to basic frame...');
  
  // Get current selection
  const selection = figma.currentPage.selection;
  console.log(`📝 Current selection: ${selection.length} items`);
  
  if (selection.length === 0) {
    throw new Error('Please select an element first');
  }

  const node = selection[0];
  console.log('🔍 Selected node dimensions:', {
    name: node.name,
    totalWidth: Math.round(node.width),
    totalHeight: Math.round(node.height),
    type: node.type
  });

  // Initialize content bounds
  let contentBounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };

  let visibleElements = 0;
  let totalElements = 0;
  let hasFoundContent = false;

  // Helper function to get node's transform or default transform
  function getNodeTransform(node) {
    // Default identity transform
    const defaultTransform = [[1, 0, 0], [0, 1, 0]];
    
    try {
      if (!node.transform) {
        return defaultTransform;
      }
      
      // Ensure transform has the correct structure
      if (!Array.isArray(node.transform) || 
          node.transform.length !== 2 || 
          !Array.isArray(node.transform[0]) || 
          !Array.isArray(node.transform[1])) {
        return defaultTransform;
      }
      
      return node.transform;
    } catch (error) {
      console.warn('Error getting transform for node:', node.name, error);
      return defaultTransform;
    }
  }

  // Helper function to combine transforms
  function combineTransforms(parentTransform, childTransform) {
    try {
      return [
        [
          childTransform[0][0] * parentTransform[0][0],
          childTransform[0][1] * parentTransform[0][1],
          childTransform[0][2] + parentTransform[0][2]
        ],
        [
          childTransform[1][0] * parentTransform[1][0],
          childTransform[1][1] * parentTransform[1][1],
          childTransform[1][2] + parentTransform[1][2]
        ]
      ];
    } catch (error) {
      console.warn('Error combining transforms:', error);
      return parentTransform;
    }
  }

  // Recursive function to find true content bounds
  function analyzeBounds(node, parentTransform = [[1, 0, 0], [0, 1, 0]]) {
    if (!node || !node.visible) return;

    totalElements++;
    
    // Get node's transform safely
    const nodeTransform = getNodeTransform(node);
    // Combine with parent transform
    const absoluteTransform = combineTransforms(parentTransform, nodeTransform);

    // Check if node has actual visible content
    const hasVisibleFills = 'fills' in node && 
      node.fills && 
      node.fills.length > 0 && 
      node.fills.some(fill => fill.visible && fill.opacity > 0);

    const hasVisibleStrokes = 'strokes' in node && 
      node.strokes && 
      node.strokes.length > 0 && 
      node.strokes.some(stroke => stroke.visible && stroke.opacity > 0);

    const hasVisibleEffects = 'effects' in node && 
      node.effects && 
      node.effects.length > 0 && 
      node.effects.some(effect => effect.visible);

    // If node has any visible content
    if (hasVisibleFills || hasVisibleStrokes || hasVisibleEffects) {
      visibleElements++;
      hasFoundContent = true;

      try {
        const absoluteX = absoluteTransform[0][2];
        const absoluteY = absoluteTransform[1][2];
        
        // Include stroke weights in bounds calculation if present
        const strokeWeight = ('strokeWeight' in node && node.strokeWeight) ? node.strokeWeight : 0;
        
        contentBounds.minX = Math.min(contentBounds.minX, absoluteX - strokeWeight/2);
        contentBounds.minY = Math.min(contentBounds.minY, absoluteY - strokeWeight/2);
        contentBounds.maxX = Math.max(contentBounds.maxX, absoluteX + node.width + strokeWeight/2);
        contentBounds.maxY = Math.max(contentBounds.maxY, absoluteY + node.height + strokeWeight/2);
        
        console.log(`📍 Visible element found:`, {
          name: node.name,
          type: node.type,
          position: {
            x: Math.round(absoluteX),
            y: Math.round(absoluteY)
          },
          size: {
            width: Math.round(node.width),
            height: Math.round(node.height)
          }
        });
      } catch (error) {
        console.warn('Error processing node bounds:', node.name, error);
      }
    }

    // Recursively analyze children
    if ('children' in node && node.children) {
      node.children.forEach(child => {
        try {
          analyzeBounds(child, absoluteTransform);
        } catch (error) {
          console.warn('Error analyzing child node:', child.name, error);
        }
      });
    }
  }

  try {
    analyzeBounds(node);

    // If no visible content was found, use node's position for default size
    if (!hasFoundContent) {
      try {
        const nodeTransform = getNodeTransform(node);
        contentBounds = {
          minX: nodeTransform[0][2],
          minY: nodeTransform[1][2],
          maxX: nodeTransform[0][2] + 100,
          maxY: nodeTransform[1][2] + 100
        };
      } catch (error) {
        console.warn('Error setting default bounds:', error);
        contentBounds = {
          minX: 0,
          minY: 0,
          maxX: 100,
          maxY: 100
        };
      }
    }

    // Calculate content dimensions
    const contentWidth = contentBounds.maxX - contentBounds.minX;
    const contentHeight = contentBounds.maxY - contentBounds.minY;

    // Calculate wasted space
    const wastedWidth = node.width - contentWidth;
    const wastedHeight = node.height - contentHeight;
    const wastedPercentageWidth = Math.round((wastedWidth / node.width) * 100);
    const wastedPercentageHeight = Math.round((wastedHeight / node.height) * 100);

    // Log detailed analysis
    console.log('📊 Content Analysis Results:', {
      totalElements,
      visibleElements,
      hasFoundContent,
      groupDimensions: {
        width: Math.round(node.width),
        height: Math.round(node.height),
        area: Math.round(node.width * node.height)
      },
      viewableContentDimensions: {
        width: Math.round(contentWidth),
        height: Math.round(contentHeight),
        area: Math.round(contentWidth * contentHeight)
      },
      wastedSpace: {
        width: Math.round(wastedWidth),
        height: Math.round(wastedHeight),
        percentageWidth: wastedPercentageWidth,
        percentageHeight: wastedPercentageHeight
      },
      contentBounds: {
        top: Math.round(contentBounds.minY),
        right: Math.round(contentBounds.maxX),
        bottom: Math.round(contentBounds.maxY),
        left: Math.round(contentBounds.minX)
      }
    });

    // Notify UI of analysis results
    figma.ui.postMessage({
      type: 'frame-down-analysis',
      data: {
        groupSize: {
          width: Math.round(node.width),
          height: Math.round(node.height)
        },
        viewableContent: {
          width: Math.round(contentWidth),
          height: Math.round(contentHeight)
        },
        wastedSpace: {
          percentageWidth: wastedPercentageWidth,
          percentageHeight: wastedPercentageHeight
        }
      }
    });

    // Add padding buffer (10% of content size)
    const paddingBuffer = Math.max(contentWidth, contentHeight) * 0.1;

  // Create new frame
    console.log('📦 Creating new frame with content-aware dimensions...');
  const frame = figma.createFrame();
  frame.name = node.name; // Set frame name to match the selected node's name
  
    // Make it square based on the larger content dimension plus padding
    const maxContentSize = Math.max(contentWidth, contentHeight) + (paddingBuffer * 2);
    console.log(`📏 Setting frame size to ${maxContentSize}x${maxContentSize}`);
    frame.resize(maxContentSize, maxContentSize);
    
    // Set up frame properties
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisAlignItems = 'MAX'; // Align to bottom
  frame.counterAxisAlignItems = 'MAX'; // Align to right
  frame.layoutSizingHorizontal = 'FIXED';
  frame.layoutSizingVertical = 'FIXED';
    frame.clipsContent = false; // Prevent content clipping
    frame.constrainProportions = true; // Maintain aspect ratio when scaling
  
  // Position frame at the center of the viewport
  const viewport = figma.viewport;
    frame.x = viewport.center.x - (maxContentSize / 2);
    frame.y = viewport.center.y - (maxContentSize / 2);
  
  // Move the selected node into the frame
  console.log('➡️ Moving node into frame...');
  frame.appendChild(node);

    // Set up node constraints and properties
    if ('constraints' in node) {
      node.constraints = {
        horizontal: 'SCALE',
        vertical: 'SCALE'
      };
    }
    if ('constrainProportions' in node) {
      node.constrainProportions = true;
    }

    // Add a subtle border to make frame bounds visible
    frame.strokeWeight = 1;
    frame.strokes = [{
      type: 'SOLID',
      color: { r: 0.8, g: 0.8, b: 0.8 }
    }];

  // Select the new frame and ensure it's visible in the viewport
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);

    console.log('✅ Enhanced basic frame conversion complete');
  return {
    success: true,
    frame: {
      id: frame.id,
      name: frame.name,
      width: frame.width,
        height: frame.height,
        contentWidth,
        contentHeight,
        wastedSpace: {
          width: wastedWidth,
          height: wastedHeight,
          percentageWidth: wastedPercentageWidth,
          percentageHeight: wastedPercentageHeight
        }
      }
    };
  } catch (error) {
    console.error('❌ Error in frame conversion:', error);
    throw new Error(`Frame conversion failed: ${error.message}`);
  }
}

async function frameUp() {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    throw new Error('Please select at least one item');
  }

  // Store the original parent for insertion order
  const originalParent = selection[0].parent;
  const nextSibling = selection[0].nextSibling;
  
  // Create a frame that will contain all selected items
  const frame = figma.createFrame();
  frame.name = "New Frame"; // We'll update this after appending the first item
  
  // Calculate the bounding box of all selected items
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  
  selection.forEach(node => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });
  
  // Set frame position and size
  frame.x = minX;
  frame.y = minY;
  frame.resize(maxX - minX, maxY - minY);
  
  // Set frame properties for hugging content
  frame.layoutMode = "HORIZONTAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.itemSpacing = 0;
  frame.paddingLeft = 0;
  frame.paddingRight = 0;
  frame.paddingTop = 0;
  frame.paddingBottom = 0;
  
  // Move all selected items into the frame and lock their aspect ratios
  let isFirstItem = true;
  selection.forEach(node => {
    if (node.type !== 'FRAME') {
      // Adjust position relative to the new frame
      node.x = node.x - frame.x;
      node.y = node.y - frame.y;
      
      // Lock aspect ratio if the node supports it
      if ('constrainProportions' in node) {
        node.constrainProportions = true;
      }
    }
    
    // Move the node into the frame
    frame.appendChild(node);
    
    // Update frame name to match the first appended item's name
    if (isFirstItem) {
      frame.name = node.name;
      isFirstItem = false;
    }
  });

  // Insert the frame in the original position in the layer stack
  if (nextSibling) {
    originalParent.insertChild(originalParent.children.indexOf(nextSibling), frame);
  } else {
    originalParent.appendChild(frame);
  }
  
  // Select the new frame without changing viewport
  figma.currentPage.selection = [frame];
  
  return {
    success: true,
    message: 'Created aspect-locked frame successfully'
  };
}

// Add the exportTileMap function
function logStep(step, details = '') {
  const message = details ? `${step} - ${details}` : step;
  console.log(message);
}

async function exportTileMap(params) {
  logStep('🚀 Starting the export function');
  const selection = figma.currentPage.selection;
  
  if (selection.length !== 1 || selection[0].type !== 'FRAME') {
    console.error('Please select a single frame to export');
    return {
      success: false,
      error: 'Please select a single frame to export'
    };
  }

  const selectedFrame = selection[0];
  logStep('📋 Selected frame', `${selectedFrame.name}`);

  const TILE_SIZE = params.gridSize || 32;
  const WIDTH = Math.ceil(selectedFrame.width / TILE_SIZE);
  const HEIGHT = Math.ceil(selectedFrame.height / TILE_SIZE);

  // Create empty ground layer data with proper dimensions
  const groundLayerData = new Array(WIDTH * HEIGHT).fill(0);

  // Convert children to collision objects with complete properties
  const objects = selectedFrame.children.map((child, index) => {
    const bounds = child.absoluteBoundingBox;
    return {
      id: index + 1,
      name: child.name || `Object ${index + 1}`,
      type: child.type.toLowerCase(),
      x: Math.round(bounds.x - selectedFrame.absoluteBoundingBox.x),
      y: Math.round(bounds.y - selectedFrame.absoluteBoundingBox.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      rotation: child.rotation || 0,
      visible: child.visible,
      properties: {}
    };
  });

  const mapData = {
    compressionlevel: -1,
    height: HEIGHT,
    width: WIDTH,
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    infinite: false,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: "1.10.1",
    type: "map",
    version: "1.10",
    nextlayerid: 3,
    nextobjectid: objects.length + 1,
    layers: [
      {
        id: 1,
        name: "Ground",
        type: "tilelayer",
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        opacity: 1,
        visible: true,
        data: groundLayerData
      },
      {
        id: 2,
        name: "Collision",
        type: "objectgroup",
        draworder: "topdown",
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        objects: objects
      }
    ],
    tilesets: [
      {
        firstgid: 1,
        name: "tilemap",
        tilewidth: TILE_SIZE,
        tileheight: TILE_SIZE,
        spacing: 0,
        margin: 0,
        image: "tileset.png",
        imagewidth: selectedFrame.width,
        imageheight: selectedFrame.height,
        columns: WIDTH,
        tilecount: WIDTH * HEIGHT
      }
    ]
  };

  // Log the complete map data for debugging
  console.log('Generated Tile Map Data:', JSON.stringify(mapData, null, 2));

  // Return the complete result
  return {
    success: true,
    mapData: mapData
  };
}

// Add selection change listener
figma.on('selectionchange', () => {
  logSelectionInfo();
});

// Function to log selection information
function logSelectionInfo() {
  const selection = figma.currentPage.selection;

  console.log('🎯 Selection changed:', {
    count: selection.length,
    types: selection.map(node => node.type)
  });

  // Check if a frame is selected
  if (selection.length === 1 && selection[0].type === "FRAME") {
    const frame = selection[0];
    console.log('📦 Selected frame:', {
      name: frame.name,
      id: frame.id,
      size: `${frame.width}x${frame.height}`
    });

    // Log children information
    console.log('🔍 Frame contents:');
    frame.children.forEach(node => {
      if ("absoluteBoundingBox" in node) {
        const { x, y, width, height } = node.absoluteBoundingBox;
        console.log(`  • ${node.name}:`, {
          type: node.type,
          position: `(${Math.round(x)}, ${Math.round(y)})`,
          size: `${Math.round(width)}x${Math.round(height)}`
        });
      }
    });
  }
}
