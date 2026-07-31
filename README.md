# Excalidraw Smart Presentation

Create dynamic, animated presentations directly within Excalidraw.

This tool allows you to define **frames** as slides, automatically animating elements that persist between frames. It enables seamless transitions and a structured way to present ideas visually.

https://github.com/user-attachments/assets/62033fca-03ca-489f-aeeb-5d51331deac9

**Presentation source:** Available in [`./presentation-docs`](./presentation-docs).

## How to Use

1. **Create Frames:**

   - Use the **Frame tool** (`f` key, toolbar, or command palette).
   - Each frame represents a slide.

2. **Define Slide Order:**

   - Frames are ordered based on their **y-axis position**.

3. **Animations:**

   - Elements that are duplicated from one frame to the other are animated on slide transition by interpolating the changes in their properties.
   - This behavior can be customized (see below).

4. **Present Your Slides:**

   - Click **"Present"** in the bottom-right corner (also accessible via the command palette or menu).
   - Navigate using `→` / `←` arrow keys, or click the sides of the presentation.

https://github.com/user-attachments/assets/7920f88c-01c0-4b3f-8620-13bd5ae86d03

### Presenting shortcuts

| Keys | Action |
| --- | --- |
| `→` `↓` `Space` `Page Down` | Next slide |
| `←` `↑` `Page Up` | Previous slide |
| `G` | Open the slide switcher (thumbnail grid) |
| digits then `Enter` | Jump straight to that slide number |
| `Home` / `End` | First / last slide |
| `Esc` | Close the switcher, or discard a half-typed slide number |

The slide counter in the bottom-right corner shows the current slide number and opens the switcher when clicked. Inside the switcher, arrow keys move the selection and `Enter` jumps to it.

## Tips & Tricks

- **Start from a Specific Slide:**

  - Select a frame, then click **"Present"**.
  - Or, while presenting, press `G` and pick the slide — handy for jumping back when a talk goes off script.

- **Maintain a 16:9 Aspect Ratio or any exact size:**

  - Edit frame size via **"Canvas & Shape Properties"** (`Alt + /` or command palette).

- **Duplicate an element into the exact same position in the next frame:**

  - Select an element, then press **`Ctrl + Shift + D`**
  - Or use **"Duplicate into next frame"** from the command palette.

https://github.com/user-attachments/assets/05e9a464-6e82-492b-9961-af0500822534

- **Fix Unintended Animations:**

  - Elements with the **same name** in consecutive frames are animated.
  - Elements are given the same name on duplication, hence why duplicated elements are animated.
  - Rename elements in **"Canvas & Shape Properties"** to prevent unwanted animations or to animate different elements.

https://github.com/user-attachments/assets/6f5cc273-15b3-4c63-aa4c-2b67f6051e03

### Progressive reveal (one element per slide)

You can build slides where each frame adds one more element to the previous frame:

1. **Frame 1:** One shape (e.g. a circle).
2. **Frame 2:** The same shape + a second element (e.g. circle + arrow).
3. **Frame 3:** Same shape + second element + a third (e.g. circle + arrow + circle).
4. And so on.

**How to do it:**

- Create one frame per step and place elements inside each frame (drag elements into the frame or use **Duplicate into next frame** `Ctrl + Shift + D`).
- For elements that should **persist and animate** from the previous slide, give them the **same name** in **Canvas & Shape Properties** (e.g. `circle1` in frame 1, and again `circle1` in frame 2 and 3). Each new element gets its own name (e.g. `arrow1`, `circle2`).
- Frames are ordered by their **y position** (top to bottom = first slide to last).

**Example:** [`presentation-docs/ProgressiveRevealExample.excalidraw`](./presentation-docs/ProgressiveRevealExample.excalidraw) — slide 1: circle only; slide 2: circle + arrow; slide 3: circle + arrow + second circle. Open it and click **Present** to see the progressive reveal.

## Current Limitations

- Animation duration (300 ms) and type (linear) are not customizable.
- Can't create shareable links.

## Other demos

[Excalidraw freedraw tool presentation](https://www.youtube.com/watch?v=DLzGZTuciMo)
