# Skills: TripMind Next.js Chat UI

> **Purpose**: This file teaches AI coding assistants how to work correctly in this codebase.
> Read this before writing or modifying any code in `chat-ui/`.

---

## 📁 Project Structure

```
chat-ui/
├── app/
│   ├── layout.tsx          # Root layout — sets <html> lang, metadata, and global font
│   ├── globals.css         # Global CSS reset and CSS custom properties (design tokens)
│   ├── page.tsx            # Main page — ALL UI lives here (single-page app)
│   ├── page.module.css     # CSS Modules for page.tsx — scoped styles only
│   └── api/
│       └── plan/
│           └── route.ts    # Next.js App Router API route — proxies to Python backend
├── public/                 # Static assets
├── next.config.ts          # Next.js config (rewrites, etc.)
├── tsconfig.json           # TypeScript config
└── package.json
```

---

## ⚙️ Tech Stack

| Layer       | Choice                      | Notes                                      |
|-------------|-----------------------------|--------------------------------------------|
| Framework   | **Next.js 16** (App Router) | Uses `app/` directory, NOT `pages/`        |
| Language    | **TypeScript** (strict)     | All components are `.tsx`                  |
| Styling     | **CSS Modules**             | `*.module.css` — no Tailwind, no inline sx |
| State       | **React useState/useRef**   | No Redux, no Zustand                       |
| Data fetch  | **fetch** via `/api/plan`   | Next.js API route proxies to Python        |
| Runtime     | **Node.js** dev server      | `npm run dev` → http://localhost:3000      |

---

## 🎨 Design System (CSS Custom Properties)

All design tokens are defined in `globals.css`. **Always use these variables — never hardcode colors or sizes.**

### Color Tokens
```css
--bg-primary        /* Main page background — deepest dark */
--bg-secondary      /* Sidebar / card backgrounds */
--bg-hover          /* Hover state background */
--border-subtle     /* Subtle borders on cards */
--text-primary      /* Main readable text */
--text-secondary    /* Supporting text */
--text-muted        /* Timestamps, labels, de-emphasized */
--accent-primary    /* Primary brand gradient start (purple/violet) */
--accent-secondary  /* Accent highlight color */
--accent-red        /* Error state color */
```

### Spacing & Shape Tokens
```css
--radius-sm   /* Small border radius — tags, chips */
--radius-md   /* Medium — cards, bubbles */
--radius-lg   /* Large — input boxes, modals */
```

### Usage Rule
```tsx
// ✅ Correct
style={{ color: "var(--text-secondary)", background: "var(--bg-hover)" }}

// ❌ Wrong — never hardcode
style={{ color: "#aaa", background: "#1a1a2e" }}
```

---

## 🧩 Component Architecture

### Single-File Pattern
`page.tsx` contains **all UI components** in one file. This is intentional for this project scope.

Component order in the file:
1. Type definitions (interfaces)
2. Constants (`STEPS`, `QUICK_PROMPTS`)
3. Pure helper functions (`formatTime`, `starsDisplay`, `parseIntent`)
4. Sub-components (`ItineraryView`)
5. Default export `Home` — the main page

### Adding a New Sub-Component
Place it **above** the `Home` component export, below existing helpers:
```tsx
// ── MyNewComponent ───────────────────────────────────────────────────────────
function MyNewComponent({ prop }: { prop: string }) {
  return <div className={styles.myNewComponent}>{prop}</div>;
}
```
Then add corresponding styles in `page.module.css`.

---

## 📡 API Layer

### How `/api/plan` Works
```
Browser → POST /api/plan → Next.js route.ts → Python backend (http://localhost:8000/plan)
```

The Next.js API route at `app/api/plan/route.ts` is a **thin proxy** — it forwards the request body to the Python LangGraph backend and returns the JSON response.

### Request Shape (sent to Python)
```ts
interface PlanRequest {
  destination: string;   // e.g. "Coorg, Karnataka"
  origin: string;        // e.g. "Bengaluru"
  num_days: number;      // e.g. 3
  num_people: number;    // e.g. 4
}
```

### Response Shape (from Python)
```ts
{
  itinerary: Itinerary;  // See Itinerary interface in page.tsx
  // or
  error: string;
}
```

### Adding New API Routes
Create `app/api/<name>/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch("http://localhost:8000/<endpoint>", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json());
}
```

---

## 🔄 State Management

### Message Types
```ts
type MessageType = "user" | "ai" | "typing" | "itinerary" | "error";
```

### Message Flow
```
User types → sendMessage() called
  → append userMsg + typingMsg to messages[]
  → startStepAnimation() — cycles through STEPS
  → fetch /api/plan
  → stopStepAnimation()
  → remove typingMsg, append itinerary/error message
```

### Step Animation
The `currentStep` state drives the progress indicator during API calls.
- `currentStep === -1` → hidden
- `currentStep === i` → active (pulsing)
- `currentStep > i` → done (checked)
- `currentStep >= STEPS.length` → all complete

**Do not modify the step interval logic without understanding `stepIntervalRef` cleanup.**

---

## 🖋️ Styling Conventions (CSS Modules)

### File: `page.module.css`
- All class names are **camelCase**: `.itineraryCard`, `.statsRow`, `.stopChip`
- Compose complex layouts with CSS Grid and Flexbox only
- Animations use `@keyframes` defined at the bottom of the file

### Adding New Styles
1. Add the class to `page.module.css`
2. Reference it as `styles.myClassName` in JSX
3. Never use global class names from inside a module file

```tsx
// ✅
<div className={styles.myCard}>

// ✅ Conditional
<div className={`${styles.tab} ${isActive ? styles.active : ""}`}>

// ❌ Never
<div className="myCard">
```

---

## 🚀 Running the App

### Development
```bash
cd chat-ui
npm run dev          # Starts on http://localhost:3000
```

### With Python Backend
```bash
# Terminal 1 — Python LangGraph backend
cd /Users/sendils/work/repo/langGraph
python trip_planner.py   # Starts on http://localhost:8000

# Terminal 2 — Next.js frontend
cd chat-ui
npm run dev
```

### Checking if Already Running
```bash
lsof -i :3000   # Check if Next.js is running
lsof -i :8000   # Check if Python backend is running
```

---

## 🧠 Key Interfaces (Data Shapes)

Always reference these when working with API data:

```ts
Itinerary
├── trip_summary: { destination, origin, num_days, num_travellers }
├── travel_route: { total_distance_km, estimated_drive_hours, highway,
│                   departure_time, arrival_time, fuel_stops[], rest_stops[] }
├── days: { "Day 1": DayPlan, "Day 2": DayPlan, ... }
│   └── DayPlan: { meals: Meal[], activities: Activity[], accommodation: Homestay }
├── all_homestay_options: Homestay[]
└── weather?: WeatherData
    └── WeatherData: { location, days: WeatherDay[], source }
```

---

## ⚠️ Common Pitfalls

1. **Don't use `pages/` directory** — this project uses the Next.js App Router (`app/`)
2. **Don't use `getServerSideProps` or `getStaticProps`** — App Router uses `async` Server Components or fetch inside API routes
3. **All interactive components need `"use client"`** — `page.tsx` has it at the top; don't remove it
4. **CSS variables must be referenced with `var()`** — they are not available as JS objects
5. **Python backend must be running** for the plan API to work — Next.js has no mock fallback
6. **`page.module.css` is NOT global** — don't try to override it from `globals.css` using class names

---

## 📝 Quick Prompts & STEPS Constants

These are defined as constants at the top of `page.tsx`. To add a new quick prompt:
```ts
const QUICK_PROMPTS = [
  // existing...
  { icon: "🏖️", title: "Beach Escape", desc: "Coastal getaway", prompt: "Plan a 3-day trip to Goa for 4 people." },
];
```

To add a new LangGraph step to the progress indicator:
```ts
const STEPS = [
  // existing...
  { label: "New Step", icon: "🔧" },
];
```

---

## 🔗 Related Files

| File | Purpose |
|------|---------|
| `../trip_planner.py` | Python LangGraph backend — the source of all itinerary data |
| `AGENTS.md` | Agent-specific rules for Next.js version awareness |
| `CLAUDE.md` | Points to `AGENTS.md` for Claude Code |
| `README.md` | Project overview and setup guide |
