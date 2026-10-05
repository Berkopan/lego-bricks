# Phone and tablet controls

The existing web app includes touch controls; no native installation or keyboard is required. The touch layout is enabled only when the browser reports a coarse primary pointer, which targets phones and tablets without turning a narrow desktop browser window into the touch UI. Mouse controls, keyboard shortcuts, and the existing desktop panel breakpoint remain unchanged.

## Gestures

| Action | Gesture or control |
| --- | --- |
| Select a brick | Tap it in Build / Parça mode. Small finger movements do not lift it. |
| Move a brick | Drag it with one finger in Build mode. The assembly remains held when the finger lifts. |
| Orbit the camera | Drag empty space, or select Camera / Kamera and drag anywhere. |
| Pan the camera | Move two fingers together. |
| Zoom | Pinch with two fingers, or use the + / − camera buttons. |
| Rotate a brick | Use the X, Y or Z buttons in Tools / Araçlar. |
| Lift or lower | Use the height + / − buttons; hold to repeat. |
| Fine positioning | Use the camera-relative arrow buttons; hold to repeat. |
| Connect | When alignment turns green, tap the connect button. |
| Detach | Select an assembly connection in the list, then tap Separate / Ayır. |
| Release or delete | Use the corresponding selection-panel button. |
| Save or open a scene | Use the existing footer controls and the device's file picker. |

Adding a second finger to an active brick drag ends the editing gesture without dropping the assembly, then transfers control to the camera. Lift both fingers after a pinch before starting another brick drag. This prevents an accidental move when one finger leaves before the other.

## Layout

Phones use a bottom-sheet library and a collapsible selection panel. The selection panel shrinks during a drag; tap Tools to expand it again. Opening the library hides the selection panel on narrow screens. Tablets use side panels; landscape phones use compact side panels with independently scrollable content. Controls account for display safe areas and the dynamic viewport height. The library closes when a new brick is selected or added.

Touch targets are at least 44 CSS pixels high, controls have accessible labels, and touch instructions are available in English and Turkish. Hidden library controls are inert. Scene serialization and the physics engine are unchanged.

## Regression checks

Run `npm test` and `npm run build`. `tests/touch.test.ts` covers taps, jitter thresholds, pointer ownership, empty-space orbit, explicit camera mode, one-to-two-finger transitions, both release orders, third fingers, duplicate events, cancellation, and coincident pinch points.

For browser or physical-device QA, check a narrow phone in portrait and landscape, a portrait tablet, and a large landscape tablet. Verify:

1. Add and select bricks; drag without moving the camera. In Camera mode, orbit over bricks without selecting them.
2. Start a pinch directly over a brick, add a second finger during a drag, and lift fingers in either order. A remaining finger must not resume editing.
3. Hold each height/position button, release outside it, change orientation, or background the tab. Movement must stop and later gestures must still work.
4. Rotate on all three axes, connect using the demo, separate from the connection list, release and delete. Switch EN/TR with a selection active.
5. Scroll panels without moving the scene. Reach all controls with the browser chrome visible and in landscape. Save and reopen the JSON scene using the platform file picker.
6. On desktop, verify left-drag orbit, right-drag pan, wheel zoom, brick dragging, seam double-click, and the existing keyboard shortcuts.

Browser emulation does not replace physical iOS Safari, iPadOS Safari or Android testing, especially for safe-area insets and file download/picker behavior.
