# Phone and tablet controls

The touch layout is enabled only when the browser reports a coarse primary pointer (`pointer: coarse`). Narrowing a desktop window does not activate it; desktop controls and the existing library breakpoint remain unchanged. Everything still runs client-side, including on GitHub Pages.

## Keep the world visible

Selecting a brick no longer opens a sheet. The selection overlay has no background, border, blur or full-screen pointer target. Only the controls in the bottom corners intercept input; the space between them remains usable for scene gestures.

- **Bottom left:** a 112px translucent joystick. Movement is relative to the camera, with a dead zone for finger jitter and proportional speed for fine positioning. Diagonals are speed-limited. Release the stick to stop moving; the brick stays held, like direct dragging.
- **Bottom right:** small lift/lower, Y rotation, more-tools and Connect buttons. Height buttons support hold-to-repeat. Connect mirrors the existing engine's availability and animation progress.
- **More tools (`…`):** an explicitly opened, height-limited corner popover with X/Z tilt, upright, pick up/release, directional nudges, connection selection/separation and delete. It starts closed on every new selection; dragging, tapping the scene or switching modes closes it. Long content scrolls inside the popover instead of covering more of the world.

The persistent joystick is outside the re-rendered selection content so grabbing a free brick or updating the selected part does not destroy pointer capture. Selection changes, release, pointer cancellation, lost capture, blur, page hiding, resize, library opening and Camera mode stop active movement. A different control or canvas gesture takes ownership rather than moving a brick and camera simultaneously.

On phones and tablets (portrait or landscape), the corner controls respect the footer and safe-area insets. Opening the library or switching to Camera hides the editing overlay. The library retains its phone bottom-sheet and tablet/landscape layouts.

## Existing gestures

Tap a brick to select it or drag it directly to move it. Drag empty space to orbit; Camera mode allows orbiting over bricks. Use two fingers to pan/pinch zoom. Adding a second finger during a direct brick drag transfers control to the camera without dropping the assembly. Lift both fingers before starting another edit.

Save/open remain in the footer. The joystick has a keyboard arrow-key fallback, all controls have English/Turkish accessible labels, and the extra-tools popover provides 44px directional buttons as an alternative to dragging. Physics, scene serialization and desktop shortcuts are unchanged.

## Regression checks

Run `npm test` and `npm run build`. Existing touch tests cover gesture ownership. `tests/joystick.test.ts` covers jitter, analog speed, diagonal/out-of-bounds clamping, invalid geometry, frame-rate independence, interrupted-frame limits, pointer ownership and cancellation.

For browser/device QA:

1. Select/add a brick on a narrow phone, landscape phone and tablet. The details popover must start closed; the scene center and space between controls must remain visible and interactive.
2. Move with the joystick; release outside the pad and verify immediate stopping. Start from a free brick: grabbing/re-rendering must not break the gesture. Test height, Y rotation and Connect. A disabled Connect must never bypass the engine's alignment check.
3. Open `…`, test X/Z, upright, release, delete and seam selection/separation. Verify long lists are scrollable and focus returns to `…` on close. Tap the scene to dismiss without swallowing the scene gesture.
4. While holding the joystick or a repeat button, change selection, open the library, switch to Camera, resize/rotate, background the page or cancel the pointer. No continued movement or stale input should survive.
5. Switch EN/TR with a selection active; check labels and Connect. Verify direct brick dragging and two-finger camera gestures still work.
6. On desktop at wide and narrow widths, verify the original selection panel, mouse/keyboard controls and height-button click behavior; the joystick must remain hidden.

Browser emulation does not replace physical iOS Safari, iPadOS Safari or Android testing, especially safe-area and file picker/download behavior.
