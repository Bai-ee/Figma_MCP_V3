console.log('🔵 Plugin code starting...');

interface PluginMessage {
  type: string;
  id?: string;
  [key: string]: any;
}

interface TileMessage {
  type: 'generate-tiles';
  id: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  spacing: number;
}

interface ConvertMessage {
  type: 'convert-to-frame';
  id: string;
}

interface ExecuteCommandMessage {
  type: 'execute-command';
  id: string;
  command: string;
  params?: any;
}

type Message = TileMessage | ConvertMessage | ExecuteCommandMessage;

console.log('🟡 Setting up plugin UI...');
figma.showUI(__html__, { width: 320, height: 480 });
console.log('🟢 Plugin UI shown');

// Send test message to UI
figma.ui.postMessage({
  type: 'test',
  message: 'Plugin loaded and running'
});

// Listen for selection changes
figma.on("selectionchange", () => {
  console.log(`👀 Selection changed: ${figma.currentPage.selection.length} items`);
  figma.ui.postMessage({
    type: 'selection-updated',
    selection: figma.currentPage.selection
  });
});

figma.ui.onmessage = async (msg: Message) => {
  console.log("📨 Received message:", msg);

  if (msg.type === 'execute-command') {
    try {
      console.log(`🎯 Executing command: ${msg.command}`);
      switch (msg.command) {
        case 'get_selection':
          console.log('🔍 Getting current selection...');
          const selection = figma.currentPage.selection;
          console.log(`✅ Found ${selection.length} selected items`);
          
          if (selection.length > 0) {
            console.log('📝 Selected node details:', {
              id: selection[0].id,
              type: selection[0].type,
              name: selection[0].name
            });
          }

          figma.ui.postMessage({
            type: 'command-result',
            id: msg.id,
            command: 'get_selection',
            result: {
              selectionCount: selection.length,
              selection: selection.map(node => node.id)
            }
          });
          break;
        default:
          console.error('❌ Unknown command:', msg.command);
          break;
      }
    } catch (error: unknown) {
      console.error('❌ Command error:', error);
      figma.ui.postMessage({
        type: 'command-error',
        id: msg.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (msg.type === 'generate-tiles') {
    try {
      console.log('🎨 Generating tiles with params:', msg);
      const { tileWidth, tileHeight, columns, rows, spacing } = msg;

      // Create a parent frame to hold all tiles
      console.log('📦 Creating parent frame...');
      const frame = figma.createFrame();
      frame.name = 'Tile Grid';
      frame.layoutMode = 'HORIZONTAL';
      frame.counterAxisSizingMode = 'AUTO';
      frame.primaryAxisSizingMode = 'AUTO';
      frame.layoutWrap = 'WRAP';
      frame.itemSpacing = spacing;
      frame.counterAxisSpacing = spacing;
      frame.paddingLeft = 0;
      frame.paddingRight = 0;
      frame.paddingTop = 0;
      frame.paddingBottom = 0;

      // Generate tiles
      console.log(`🔄 Generating ${rows * columns} tiles...`);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const tile = figma.createRectangle();
          tile.name = `Tile ${row + 1}-${col + 1}`;
          tile.resize(tileWidth, tileHeight);
          frame.appendChild(tile);
        }
      }

      // Position the frame in the center of the viewport
      console.log('📍 Positioning frame in viewport...');
      const { x, y } = figma.viewport.center;
      frame.x = x - (frame.width / 2);
      frame.y = y - (frame.height / 2);

      // Select the frame
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);

      console.log('✅ Tiles generated successfully');
      figma.ui.postMessage({ 
        type: 'tiles-created',
        id: msg.id,
        success: true 
      });
      figma.notify('Tiles generated successfully! 🎉');
    } catch (error: unknown) {
      console.error('❌ Error generating tiles:', error);
      figma.ui.postMessage({ 
        type: 'tiles-created',
        id: msg.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      figma.notify('Error generating tiles: ' + (error instanceof Error ? error.message : String(error)), { error: true });
    }
  } else if (msg.type === 'convert-to-frame') {
    try {
      console.log('🔄 Starting frame conversion...');
      
      // Get current selection
      const selection = figma.currentPage.selection;
      console.log(`📝 Current selection: ${selection.length} items`);
      
      if (selection.length === 0) {
        throw new Error('Please select an element first');
      }

      const node = selection[0];
      console.log('🎯 Selected node:', {
        id: node.id,
        type: node.type,
        name: node.name
      });

      const originalBounds = node.absoluteBoundingBox;
      console.log('📐 Node bounds:', originalBounds);
      
      if (!originalBounds) {
        throw new Error('Unable to get bounds of selection');
      }

      // Create new auto-layout frame
      console.log('📦 Creating new auto-layout frame...');
      const frame = figma.createFrame();
      frame.name = 'Auto Layout Frame';
      
      // Make it square based on the larger dimension
      const maxSize = Math.max(originalBounds.width, originalBounds.height);
      console.log(`📏 Setting frame size to ${maxSize}x${maxSize}`);
      frame.resize(maxSize, maxSize);
      
      // Set up auto-layout
      console.log('⚙️ Configuring auto-layout properties...');
      frame.layoutMode = 'VERTICAL';
      frame.primaryAxisAlignItems = 'CENTER';
      frame.counterAxisAlignItems = 'CENTER';
      frame.layoutSizingHorizontal = 'FIXED';
      frame.layoutSizingVertical = 'FIXED';
      
      // Position frame at original location
      console.log('📍 Positioning frame at:', { x: originalBounds.x, y: originalBounds.y });
      frame.x = originalBounds.x;
      frame.y = originalBounds.y;
      
      // Move the selected node into the frame
      console.log('➡️ Moving node into frame...');
      frame.appendChild(node);
      
      // Select the new frame
      console.log('✨ Selecting new frame...');
      figma.currentPage.selection = [frame];
      
      console.log('✅ Frame conversion complete');
      figma.ui.postMessage({ 
        type: 'frame-converted',
        id: msg.id,
        success: true 
      });
      figma.notify('Converted to auto-layout frame! 🎉');
      
    } catch (error: unknown) {
      console.error('❌ Error converting to frame:', error);
      figma.ui.postMessage({ 
        type: 'frame-converted',
        id: msg.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      figma.notify('Error converting to frame: ' + (error instanceof Error ? error.message : String(error)), { error: true });
    }
  }
}; 