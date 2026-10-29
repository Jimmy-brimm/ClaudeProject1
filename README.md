# Concept Bench

A single-page workbench for invention concepts. Describe an invention and its
modules, and the page builds:

1. **Concept sheet**: goal, approach, a module table, key numbers, sanity checks,
   open questions and later experiments. Copies out as Markdown.
2. **Diagram**: an SVG of how the modules connect. The most connected module sits
   in the middle; dashed boxes are separate parts. Copies out as SVG.
3. **Image prompt**: one clean product render on a plain background, ready to
   paste into Gemini or another image tool.
4. **Numbers**: formula-based calculators for solar power, battery capacity and
   runtime, phone charges, recharge time, the walking generator, a sizing check
   and a daily energy budget. Each result shows its formula.
5. **3D**: a rough rotating model of the main shape (Three.js). Drag to turn it.
6. **Chat**: talk the design through with Claude. When it changes the design, the
   sheet, diagram, prompt, numbers and 3D shape all update, and you can undo.
   On browsers that support it, a **Speak** button lets you dictate.

The self-charging power bank is loaded as the first example project. Projects are
saved in your browser; use **More → Copy project as JSON** to back one up or
move it to another device.

## Run it

Everything except the chat works by opening `public/index.html` directly in a
browser. For the chat you need the small local server, which keeps the API key
off the page:

```sh
npm install
cp .env.example .env      # then put your key in .env
npm start                 # open http://localhost:3000
```

- Requires Node 20.12 or newer.
- `ANTHROPIC_API_KEY` is read only by `server/server.mjs` and is never sent to the
  browser. `.env` is git-ignored.
- The server listens on `127.0.0.1` only, so other machines on your network can't
  spend your key. Set `HOST=0.0.0.0` only if you understand that.
- Each chat message is one paid API call. The chat shows a rough running cost.
  `CHAT_MODEL` and `CHAT_EFFORT` in `.env` change the model and how hard it
  thinks (default `claude-opus-5-5` at `medium`).

## How the chat works

Each message sends the current project JSON, the recent conversation and your
new message to `/api/chat`. The server asks Claude for a JSON reply with a short
answer and, if the design should change, the complete updated project. The
server cleans that project up (`normalizeProject` in `public/js/model.js`)
before the page applies it.

## Limits

- No physics simulation. Every number is a simple multiplication or division
  you can check by hand; the formulas are in `public/js/calc.js`.
- The 3D view is a rough block model, not a render.
- The walking generator estimate (mass × g × travel × steps per second ×
  efficiency) gives an upper-end figure for a spring-mass harvester; expect a
  fraction of a watt.

## Files

```
public/index.html       the page
public/styles.css       styles (light and dark)
public/js/model.js      project data, the power bank example, image prompt and Markdown builders
public/js/calc.js       calculator formulas
public/js/diagram.js    SVG diagram
public/js/preview3d.js  3D preview
public/js/chat.js       chat box and voice input
public/js/app.js        wiring and storage
public/vendor/          Three.js r149 (MIT)
server/server.mjs       static files + /api/chat
test/                   formula and model tests (npm test)
```

## Design doc

The full power bank design doc, with a diagram and image prompt:
<https://claude.ai/artifact/49yxbJve2hupQM6jtQKa7U>
