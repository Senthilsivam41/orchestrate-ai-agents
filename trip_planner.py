"""
=============================================================================
 LangGraph 3-Day Family Trip Planner
 ------------------------------------
 Demonstrates:
   * Multi-node LangGraph orchestration
   * Conditional routing between agents
   * Parallel sub-tasks (restaurants, homestays, attractions)
   * Graph visualization (ASCII + matplotlib PNG)
   * Mock "tool" responses (no real API key needed)

 Architecture:
   initialize_trip
       |  (conditional)
   plan_route
       |────────────────────────────────|──────────────────────|
   find_restaurants            find_homestays         find_attractions
       |                                |                      |
       └──────────────── validate_plan ─────────────────────┘
                              |  (conditional)
                       assemble_itinerary
                              |
                            END
=============================================================================
"""

import json
import time
from typing import TypedDict, Annotated, List, Dict, Any
from datetime import datetime

import operator
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

from langgraph.graph import StateGraph, END

matplotlib.use("Agg")

# ─────────────────────────────────────────────────────────────────────────────
# 1. STATE  ── key design rule for parallel branches:
#   • Fields written by exactly ONE branch  → plain type  (last-write wins)
#   • Fields written by MULTIPLE branches  → Annotated[T, reducer]
#   • execution_log is appended by every node → use operator.add
# ─────────────────────────────────────────────────────────────────────────────

class TripState(TypedDict):
    """The state of the trip planning graph."""
    # ── Immutable inputs (set once by initialize_trip) ────────────────────
    destination:  str
    origin:       str
    num_days:     int
    num_people:   int
    preferences:  Dict[str, Any]

    # ── Outputs written by exactly one node each ──────────────────────────
    route_plan:   Dict[str, Any]          # written by  plan_route
    restaurants:  List[Dict[str, Any]]    # written by  find_restaurants
    homestays:    List[Dict[str, Any]]    # written by  find_homestays
    attractions:  List[Dict[str, Any]]    # written by  find_attractions
    itinerary:    Dict[str, Any]          # written by  assemble_itinerary

    # ── Execution log: every node appends ─────────────────────────────────
    execution_log: Annotated[List[str], operator.add]

    # ── Routing signal: written sequentially, not in parallel branches ─────
    status:       str


# ─────────────────────────────────────────────────────────────────────────────
# 2. MOCK DATA GENERATORS  (simulate LLM / API responses)
# ─────────────────────────────────────────────────────────────────────────────

def _mock_route(origin: str, destination: str) -> Dict:
    return {
        "origin":               origin,
        "destination":          destination,
        "total_distance_km":    270,
        "estimated_drive_hours": 5.0,
        "departure_time":       "06:30 AM",
        "arrival_time":         "12:00 PM (Day 1)",
        "highway":              "NH-275 (Bengaluru–Mysuru Expressway + Kushalnagar)",
        "fuel_stops": [
            "Km 60  – HP Petrol Pump, Channapatna",
            "Km 190 – Indian Oil, Kushalnagar"
        ],
        "rest_stops": [
            {
                "name":            "Kamat Upachar Highway Restaurant",
                "km_mark":         85,
                "suggested_break": "08:15 AM – 08:45 AM",
                "type":            "Breakfast stop"
            },
            {
                "name":            "Coffee Day Lounge, Kushalnagar",
                "km_mark":         195,
                "suggested_break": "10:30 AM – 11:00 AM",
                "type":            "Coffee / stretch break"
            }
        ]
    }


def _mock_restaurants(_destination: str, days: int) -> List[Dict]:
    options = [
        {"name": "Spice Garden Family Restaurant",  "cuisine": "Coorg Thali",
         "rating": 4.7, "price_range": "Rs.350-550",
          "speciality": "Authentic Pandi curry & Kadambuttu (rice dumplings)",
          "address": "Main Bazaar, Madikeri"},
        {"name": "The Mango Shade Cafe",            "cuisine": "Continental & South Indian",
         "rating": 4.4, "price_range": "Rs.400-700",
          "speciality": "Fresh pepper chicken & wood-fire pizzas",
          "address": "Raja's Seat Road"},
        {"name": "Coorg Heritage Dining",           "cuisine": "Traditional Kodava",
         "rating": 4.8, "price_range": "Rs.500-900",
          "speciality": "Bamboo shoot curry & Coorg honey pancakes",
          "address": "Abbey Falls Road"},
        {"name": "Raintree Restaurant",             "cuisine": "Multi-cuisine",
         "rating": 4.3, "price_range": "Rs.300-600",
          "speciality": "Seafood grill & family buffet",
          "address": "Club Road, Madikeri"},
        {"name": "Misty Valley Café",               "cuisine": "Breakfast / Cafe",
         "rating": 4.5, "price_range": "Rs.150-350",
          "speciality": "Coorg filter coffee & akki roti",
          "address": "Market Cross, Madikeri"},
        {"name": "Jungle Retreat Dining",           "cuisine": "Organic Farm-to-table",
         "rating": 4.6, "price_range": "Rs.600-1000",
          "speciality": "Wild mushroom risotto & organic salads",
          "address": "Siddapur Road"},
        {"name": "Hotel Capitol Village Dhaba",     "cuisine": "North Indian Thali",
         "rating": 4.2, "price_range": "Rs.200-400",
          "speciality": "Unlimited rajma-chawal & masala chai",
          "address": "Bus Stand, Madikeri"},
        {"name": "Plantation Nest Restaurant",      "cuisine": "Coorg & Kerala Fusion",
         "rating": 4.5, "price_range": "Rs.450-750",
          "speciality": "Prawn ghee roast & coconut fish curry",
          "address": "Virajpet Bypass"},
        {"name": "Sunrise South Indian Eatery",     "cuisine": "South Indian",
         "rating": 4.6, "price_range": "Rs.100-250",
          "speciality": "Ghee podi idli & drumstick sambar",
          "address": "Temple Street, Bhagamandala"},
    ]
    meal_labels = ["Breakfast", "Lunch", "Dinner"]
    meal_times  = {"Breakfast": "08:00 AM", "Lunch": "01:00 PM", "Dinner": "07:30 PM"}
    schedule = []
    for day in range(1, days + 1):
        for i, meal in enumerate(meal_labels):
            rest = options[(day * 3 + i) % len(options)]
            schedule.append({"day": day, "meal": meal, "time": meal_times[meal], **rest})
    return schedule


def _mock_homestays(_destination: str) -> List[Dict]:
    return [
        {
            "name":                 "Coorg Heritage Haveli",
            "type":                 "Heritage Homestay",
            "rating":               4.8,
            "price_per_night":      3800,
            "rooms_available":      3,
            "amenities":            ["AC", "Home-cooked Kodava meals", "Coffee plantation tour",
                                     "Parking", "Wi-Fi", "Kids play area"],
            "hosts":                "Nanda Family (Kodava)",
            "highlights": "150-year-old estate bungalow; "
                          "hosts take guests on a guided coffee-picking walk",
            "distance_from_center": "2 km from Madikeri",
            "contact":              "+91-94481-12345"
        },
        {
            "name":                 "Green Canopy Plantation Stay",
            "type":                 "Eco Farm Homestay",
            "rating":               4.6,
            "price_per_night":      2900,
            "rooms_available":      2,
            "amenities":            ["Organic farm-to-table meals", "Bird-watching trail",
                                     "Bonfire", "Parking", "Nature walks", "River dip spot"],
            "hosts":                "Devaiah Family",
            "highlights": "Surrounded by 10 acres of coffee & spice. "
                          "Kids love spice garden walks",
            "distance_from_center": "7 km from Madikeri",
            "contact":              "+91-98861-67890"
        },
        {
            "name":                 "Misty Pines Hilltop Cottage",
            "type":                 "Hilltop View Cottage",
            "rating":               4.7,
            "price_per_night":      4500,
            "rooms_available":      2,
            "amenities":            ["360-degree valley view", "Private jacuzzi", "AC",
                                     "Barbeque", "Stargazing deck", "Parking"],
            "hosts":                "Kariappa Family",
            "highlights": "Stunning mist-covered sunrise views; private pool; "
                          "best for families with teens",
            "distance_from_center": "5 km from Madikeri",
            "contact":              "+91-90089-44321"
        }
    ]


def _mock_attractions(_destination: str, days: int) -> List[Dict]:
    all_attractions = [
        {"name": "Abbey Falls",                      "type": "Nature / Waterfall",
         "duration_hrs": 2, "entry_fee": "Free",
         "best_time": "Morning",
          "description": "Stunning 70-ft cascade surrounded by coffee & spice plantations. "
                         "10-min forest walk"},
        {"name": "Raja's Seat Viewpoint",            "type": "Scenic / Sunrise",
         "duration_hrs": 1.5, "entry_fee": "Rs.15/person",
         "best_time": "Early Morning / Evening",
          "description": "Historic garden with panoramic view of valleys & coffee estates. "
                         "Toy train for kids"},
        {"name": "Iruppu Falls Trek",                "type": "Adventure / Trek",
         "duration_hrs": 4, "entry_fee": "Rs.50/person",
         "best_time": "Morning",
          "description": "Scenic 2 km trail to a sacred 60-ft waterfall. "
                         "Moderate difficulty – great for families"},
        {"name": "Dubare Elephant Camp",             "type": "Wildlife / Family",
         "duration_hrs": 3, "entry_fee": "Rs.500/person",
         "best_time": "Morning (9–11 AM)",
         "description": "Bathe with elephants in Cauvery River. Kids' highlight of any Coorg trip"},
        {"name": "Coorg Coffee Plantation Tour",     "type": "Culture / Experience",
         "duration_hrs": 2, "entry_fee": "Rs.300/person",
         "best_time": "Morning",
          "description": "Walk through a working estate, learn coffee processing, "
                         "taste estate-fresh brew"},
        {"name": "Nagarhole National Park Safari",   "type": "Wildlife Safari",
         "duration_hrs": 3, "entry_fee": "Rs.700/vehicle",
         "best_time": "Early Morning (6–9 AM)",
          "description": "Spot tigers, leopards, elephants & 300+ birds in one of "
                         "India's premier reserves"},
        {"name": "Omkareshwara Temple",              "type": "Spiritual / Heritage",
         "duration_hrs": 1, "entry_fee": "Free",
         "best_time": "Morning",
          "description": "Unique blend of Islamic & Gothic architecture. "
                         "Peaceful backwater pond & fish feeding"},
        {"name": "Madikeri Fort & Museum",           "type": "History",
         "duration_hrs": 2, "entry_fee": "Rs.20/person",
         "best_time": "Morning",
          "description": "18th-century fort converted to museum with Kodava "
                         "artifacts & British-era exhibits"},
        {"name": "Talakaveri – Source of River Cauvery", "type": "Spiritual / Scenic",
         "duration_hrs": 2.5, "entry_fee": "Free",
         "best_time": "Morning",
          "description": "Holy origin of River Cauvery atop Brahmagiri hills; "
                         "short ropeway ride available"},
    ]
    plan = []
    for day in range(1, days + 1):
        for slot in range(3):
            idx = (day - 1) * 3 + slot
            if idx < len(all_attractions):
                plan.append({"day": day, "slot": slot + 1, **all_attractions[idx]})
    return plan


# ─────────────────────────────────────────────────────────────────────────────
# 3. GRAPH NODES
#    IMPORTANT: parallel nodes MUST return only the keys they own.
#    Returning 'status' or 'destination' from multiple parallel branches
#    would cause InvalidUpdateError because LangGraph disallows two branches
#    writing the same non-reducer key in a single super-step.
# ─────────────────────────────────────────────────────────────────────────────

def initialize_trip(state: TripState) -> dict:
    """Entry node – validates inputs and sets up the state."""
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] INITIALIZE TRIP\n"
        f"   Destination : {state['destination']}\n"
        f"   Origin      : {state['origin']}\n"
        f"   Duration    : {state['num_days']} days\n"
        f"   Travellers  : {state['num_people']} (family)"
    )
    print(log)
    time.sleep(0.2)
    return {"status": "initialized", "execution_log": [log]}


def plan_route(state: TripState) -> dict:
    """Plans the driving route with timed rest stops."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] PLAN ROUTE – "
          "calculating driving itinerary...")
    time.sleep(0.4)
    route = _mock_route(state["origin"], state["destination"])
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] ROUTE PLANNED\n"
        f"   Distance    : {route['total_distance_km']} km\n"
        f"   Drive time  : {route['estimated_drive_hours']} hrs\n"
        f"   Highway     : {route['highway']}\n"
        f"   Rest stops  : {len(route['rest_stops'])} (timed around meals)"
    )
    print(log)
    # plan_route is sequential (not parallel) so it CAN update status
    return {"route_plan": route, "status": "route_ready", "execution_log": [log]}


def find_restaurants(state: TripState) -> dict:
    """Parallel branch: finds restaurants for all meals."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] FIND RESTAURANTS – searching meal options...")
    time.sleep(0.5)
    restaurants = _mock_restaurants(state["destination"], state["num_days"])
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] RESTAURANTS FOUND\n"
        f"   Meals planned : {len(restaurants)}  ({state['num_days']} days x 3)"
    )
    print(log)
    # Return ONLY the key this branch owns + execution_log
    return {"restaurants": restaurants, "execution_log": [log]}


def find_homestays(state: TripState) -> dict:
    """Parallel branch: finds family-friendly homestays."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] FIND HOMESTAYS – searching accommodations...")
    time.sleep(0.5)
    homestays = _mock_homestays(state["destination"])
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] HOMESTAYS FOUND\n"
        f"   Options : {len(homestays)}\n"
        f"   Range   : Rs.{min(h['price_per_night'] for h in homestays)}"
        f"–Rs.{max(h['price_per_night'] for h in homestays)}/night"
    )
    print(log)
    return {"homestays": homestays, "execution_log": [log]}


def find_attractions(state: TripState) -> dict:
    """Parallel branch: discovers tourist attractions."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] FIND ATTRACTIONS – "
          "discovering places to visit...")
    time.sleep(0.5)
    attractions = _mock_attractions(state["destination"], state["num_days"])
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] ATTRACTIONS PLANNED\n"
        f"   Activities  : {len(attractions)} across {state['num_days']} days\n"
        f"   Types       : Nature, Scenic, Adventure, Wildlife, Culture, Heritage"
    )
    print(log)
    return {"attractions": attractions, "execution_log": [log]}


def validate_plan(state: TripState) -> dict:
    """Aggregator node: quality-checks all collected data."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] VALIDATE PLAN – running quality checks...")
    time.sleep(0.2)
    checks = {
        "route_exists":        bool(state.get("route_plan")),
        "meals_covered":       len(state.get("restaurants", [])) == state["num_days"] * 3,
        "accommodation_ready": bool(state.get("homestays")),
        "activities_planned":  bool(state.get("attractions")),
    }
    all_pass = all(checks.values())
    check_lines = "\n".join(f"   {'PASS' if v else 'FAIL'}  {k}" for k, v in checks.items())
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] VALIDATION {'PASSED' if all_pass else 'FAILED'}\n"
        + check_lines
    )
    print(log)
    return {"status": "validated" if all_pass else "error", "execution_log": [log]}


def assemble_itinerary(state: TripState) -> dict:
    """Final node: merges all data into a structured itinerary."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ASSEMBLE ITINERARY – "
          "building day-wise plan...")
    time.sleep(0.4)
    days = {}
    for day in range(1, state["num_days"] + 1):
        days[f"Day {day}"] = {
            "meals":         [r for r in state["restaurants"]  if r["day"] == day],
            "activities":    [a for a in state["attractions"]  if a["day"] == day],
            "accommodation": state["homestays"][0]   # top recommendation
        }
    itinerary = {
        "trip_summary": {
            "destination":    state["destination"],
            "origin":         state["origin"],
            "num_days":       state["num_days"],
            "num_travellers": state["num_people"]
        },
        "travel_route":         state["route_plan"],
        "days":                 days,
        "all_homestay_options": state["homestays"]
    }
    log = (
        f"[{datetime.now().strftime('%H:%M:%S')}] ITINERARY ASSEMBLED\n"
        f"   Days: {state['num_days']}  |  "
        f"Meals: {len(state['restaurants'])}  |  "
        f"Activities: {len(state['attractions'])}  |  "
        f"Homestay options: {len(state['homestays'])}"
    )
    print(log)
    return {"itinerary": itinerary, "status": "complete", "execution_log": [log]}


# ─────────────────────────────────────────────────────────────────────────────
# 4. CONDITIONAL ROUTING FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def route_after_init(state: TripState) -> str:
    """Routing logic after initialization."""
    return "plan_route" if state["status"] == "initialized" else END


def route_after_validation(state: TripState) -> str:
    """Routing logic after validation."""
    return "assemble_itinerary" if state["status"] == "validated" else END


# ─────────────────────────────────────────────────────────────────────────────
# 5. BUILD THE LANGGRAPH
# ─────────────────────────────────────────────────────────────────────────────

def build_graph():
    """Builds and compiles the LangGraph."""
    graph = StateGraph(TripState)

    graph.add_node("initialize_trip",    initialize_trip)
    graph.add_node("plan_route",         plan_route)
    graph.add_node("find_restaurants",   find_restaurants)
    graph.add_node("find_homestays",     find_homestays)
    graph.add_node("find_attractions",   find_attractions)
    graph.add_node("validate_plan",      validate_plan)
    graph.add_node("assemble_itinerary", assemble_itinerary)

    graph.set_entry_point("initialize_trip")

    # Conditional routing after initialization
    graph.add_conditional_edges(
        "initialize_trip", route_after_init,
        {"plan_route": "plan_route", END: END}
    )

    # Sequential: plan_route → parallel fan-out to 3 branches
    graph.add_edge("plan_route", "find_restaurants")
    graph.add_edge("plan_route", "find_homestays")
    graph.add_edge("plan_route", "find_attractions")

    # All 3 parallel branches converge at validate_plan
    graph.add_edge("find_restaurants", "validate_plan")
    graph.add_edge("find_homestays",   "validate_plan")
    graph.add_edge("find_attractions", "validate_plan")

    # Conditional routing after validation
    graph.add_conditional_edges(
        "validate_plan", route_after_validation,
        {"assemble_itinerary": "assemble_itinerary", END: END}
    )

    graph.add_edge("assemble_itinerary", END)
    return graph.compile()


# ─────────────────────────────────────────────────────────────────────────────
# 6. GRAPH VISUALIZATION  (matplotlib PNG – dark theme)
# ─────────────────────────────────────────────────────────────────────────────

NODE_STYLE = {
    "initialize_trip":    {"color": "#4A90D9", "label": "Initialize\nTrip"},
    "plan_route":         {"color": "#E67E22", "label": "Plan\nRoute"},
    "find_restaurants":   {"color": "#27AE60", "label": "Find\nRestaurants"},
    "find_homestays":     {"color": "#8E44AD", "label": "Find\nHomestays"},
    "find_attractions":   {"color": "#2980B9", "label": "Find\nAttractions"},
    "validate_plan":      {"color": "#C0392B", "label": "Validate\nPlan"},
    "assemble_itinerary": {"color": "#16A085", "label": "Assemble\nItinerary"},
    "END":                {"color": "#7F8C8D", "label": "END"},
}

POSITIONS = {
    "initialize_trip":    (0,   5.0),
    "plan_route":         (0,   3.5),
    "find_restaurants":   (-2.5, 2.0),
    "find_homestays":     (0,   2.0),
    "find_attractions":   (2.5, 2.0),
    "validate_plan":      (0,   0.5),
    "assemble_itinerary": (0,  -1.0),
    "END":                (0,  -2.5),
}

GRAPH_EDGES = [
    ("initialize_trip",    "plan_route",         "conditional"),
    ("plan_route",         "find_restaurants",   "parallel"),
    ("plan_route",         "find_homestays",     "parallel"),
    ("plan_route",         "find_attractions",   "parallel"),
    ("find_restaurants",   "validate_plan",      "converge"),
    ("find_homestays",     "validate_plan",      "converge"),
    ("find_attractions",   "validate_plan",      "converge"),
    ("validate_plan",      "assemble_itinerary", "conditional"),
    ("assemble_itinerary", "END",                "normal"),
]

EDGE_COLOR = {
    "conditional": "#E74C3C",
    "parallel":    "#3498DB",
    "converge":    "#9B59B6",
    "normal":      "#2ECC71",
}


def visualize_graph(output_path: str = "trip_planner_graph.png"):
    """Creates a visual representation of the graph using matplotlib."""
    fig, ax = plt.subplots(figsize=(13, 16))
    ax.set_facecolor("#0D1117")
    fig.patch.set_facecolor("#0D1117")
    ax.set_xlim(-4.2, 4.2)
    ax.set_ylim(-3.5, 6.5)
    ax.axis("off")

    # Title
    ax.text(0, 6.2, "LangGraph : 3-Day Family Trip Planner",
            ha="center", va="center", fontsize=16, fontweight="bold",
            color="white", fontfamily="monospace")
    ax.text(0, 5.75, "Orchestration & Data-Flow Visualization",
            ha="center", va="center", fontsize=10, color="#8B9BAE", fontfamily="monospace")

    # Edges
    for src, dst, etype in GRAPH_EDGES:
        x0, y0 = POSITIONS[src]
        x1, y1 = POSITIONS[dst]
        color = EDGE_COLOR[etype]
        # rad to slightly curve overlapping parallel arrows
        rad_map = {
            ("plan_route", "find_restaurants"): "arc3,rad=0.25",
            ("plan_route", "find_attractions"): "arc3,rad=-0.25",
        }
        rad = rad_map.get((src, dst), "arc3,rad=0.0")
        ax.annotate(
            "", xy=(x1, y1 + 0.32), xytext=(x0, y0 - 0.32),
            arrowprops={"arrowstyle": "-|>", "color": color, "lw": 2.2,
                        "connectionstyle": rad},
            zorder=2
        )

    # Nodes
    node_w, node_h = 1.2, 0.52
    for node_id, style in NODE_STYLE.items():
        x, y    = POSITIONS[node_id]
        is_end  = node_id == "END"
        w = 0.7 if is_end else node_w
        h = 0.38 if is_end else node_h
        patch = mpatches.FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h,
            boxstyle="round,pad=0.07",
            linewidth=2.5,
            edgecolor=style["color"],
            facecolor=style["color"] + "28",
            zorder=3
        )
        ax.add_patch(patch)
        ax.text(x, y, style["label"],
                ha="center", va="center", fontsize=8.5, color="white",
                fontweight="bold", zorder=4, linespacing=1.4)

    # Node-type annotations (right side)
    annotations = [
        (5.0, "#4A90D9",  "[ Entry Node ]"),
        (3.5, "#E67E22",  "[ Sequential ]"),
        (2.0, "#3498DB",  "[ Parallel Branches ]"),
        (0.5, "#C0392B",  "[ Aggregator / Validator ]"),
        (-1.0, "#16A085", "[ Output Assembler ]"),
        (-2.5, "#7F8C8D", "[ Terminal ]"),
    ]
    for y_val, col, label in annotations:
        ax.text(4.1, y_val, label, ha="right", va="center",
                fontsize=7.5, color=col, style="italic")

    # Legend
    lx, ly = -4.0, -1.8
    ax.text(lx, ly + 0.35, "Edge Types", ha="left", fontsize=9,
            color="#8B9BAE", fontweight="bold")
    for i, (label, color) in enumerate([
        ("Conditional routing", "#E74C3C"),
        ("Parallel fan-out",    "#3498DB"),
        ("Converge",            "#9B59B6"),
        ("Normal flow",         "#2ECC71"),
    ]):
        yy = ly - i * 0.38
        ax.plot([lx, lx + 0.4], [yy, yy], color=color, lw=2.5, zorder=5)
        ax.text(lx + 0.55, yy, label, va="center", fontsize=8, color="white")

    plt.tight_layout(pad=0.4)
    plt.savefig(output_path, dpi=150, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    plt.close()
    print(f"\n[Graph] Visualization saved -> {output_path}")


# ─────────────────────────────────────────────────────────────────────────────
# 7. RICH CONSOLE OUTPUT
# ─────────────────────────────────────────────────────────────────────────────

BORDER   = "=" * 72
DIVIDER  = "-" * 72

def hdr(text: str):
    """Prints a header with dividers."""
    print(f"\n{DIVIDER}\n  {text}\n{DIVIDER}")

def print_itinerary(itinerary: dict):
    """Prints the formatted itinerary to the console."""
    summary = itinerary["trip_summary"]
    route   = itinerary["travel_route"]

    print("\n\n" + BORDER)
    print(f"  3-DAY FAMILY TRIP ITINERARY")
    print(f"  Origin      : {summary['origin']}")
    print(f"  Destination : {summary['destination']}")
    print(f"  Travellers  : {summary['num_travellers']}  |  Duration: {summary['num_days']} days")
    print(BORDER)

    hdr("TRAVEL PLAN (Day 0 - Drive to Destination)")
    print(f"  Route        : {route['highway']}")
    print(f"  Distance     : {route['total_distance_km']} km  "
          f"({route['estimated_drive_hours']} hrs)")
    print(f"  Depart       : {route['departure_time']}   -->  Arrive: {route['arrival_time']}")
    print(f"  Fuel Stops   : {' | '.join(route['fuel_stops'])}")
    print("\n  Rest / Meal Stops en Route:")
    for stop in route["rest_stops"]:
        print(f"    [{stop['suggested_break']}]  {stop['name']}  ({stop['type']})")

    hdr("HOMESTAY OPTIONS (Recommended: Option 1)")
    for idx, s in enumerate(itinerary["all_homestay_options"], 1):
        amen = ", ".join(s["amenities"][:4]) + " ..."
        print(f"\n  Option {idx}: {s['name']}  ({s['type']})")
        print(f"    Rating    : {s['rating']}/5.0   |  Price : Rs.{s['price_per_night']}/night")
        print(f"    Hosts     : {s['hosts']}")
        print(f"    Highlight : {s['highlights']}")
        print(f"    Amenities : {amen}")
        print(f"    Contact   : {s['contact']}")

    for day_key, day_data in itinerary["days"].items():
        hdr(f"{day_key.upper()}")

        print("  MEALS:")
        for meal in day_data["meals"]:
            print(f"    {meal['meal']:10s} ({meal['time']}) ---> {meal['name']}")
            print(f"              Cuisine: {meal['cuisine']}  |  {meal['price_range']}")
            print(f"              '{meal['speciality']}'")

        print("\n  ACTIVITIES:")
        for act in day_data["activities"]:
            print(f"    [{act['slot']}] {act['name']}  ({act['type']}, ~{act['duration_hrs']}h)")
            print(f"        {act['description']}")
            print(f"        Entry: {act['entry_fee']}  |  Best time: {act['best_time']}")

    print(f"\n{BORDER}")
    print("  Itinerary complete. Have a wonderful family trip!")
    print(f"{BORDER}\n")


def print_execution_summary(logs: List[str]):
    """Prints the execution log from the graph."""
    hdr("LANGGRAPH EXECUTION LOG")
    for entry in logs:
        for line in entry.split("\n"):
            print(f"  {line}")


# ─────────────────────────────────────────────────────────────────────────────
# 8. MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    """Main execution function."""
    print(f"\n{BORDER}")
    print("  LangGraph  -  Family Trip Planner  (Orchestration Demo)")
    print(BORDER)

    initial_state: TripState = {
        "destination":  "Coorg, Karnataka",
        "origin":       "Bengaluru",
        "num_days":     3,
        "num_people":   4,
        "preferences": {
            "accommodation_type": "homestay",
            "food_preference":    "vegetarian-friendly",
            "activity_level":     "moderate",
            "budget_per_day":     9000
        },
        "route_plan":    {},
        "restaurants":   [],
        "homestays":     [],
        "attractions":   [],
        "itinerary":     {},
        "execution_log": [],
        "status":        "pending"
    }

    # Build
    print("\n[1] Building LangGraph ...")
    app = build_graph()

    # Visualise the graph structure
    print("[2] Rendering graph visualization ...")
    visualize_graph("trip_planner_graph.png")

    # ASCII architecture diagram
    print("\n[3] LangGraph Architecture (ASCII):")
    print("""
     +---------------------+
     |   initialize_trip   |  <-- Entry Node (validates inputs)
     +----------+----------+
                |  (conditional routing)
     +----------v----------+
     |      plan_route     |  <-- Sequential (driving itinerary)
     +--+----------+----+--+
        |          |    |       < parallel fan-out >
  +-----v--+  +----v--+  +----v---------+
  |  find_ |  | find_ |  | find_        |
  |restaurants| |homestays| | attractions  |
  +-----+--+  +----+--+  +----+---------+
        |          |          |       < converge >
     +--v----------v----------v--+
     |        validate_plan       |  <-- Aggregator (quality checks)
     +----------+-----------------+
                |  (conditional routing)
     +----------v----------+
     |  assemble_itinerary |  <-- Output Assembler
     +----------+----------+
                |
              [END]
    """)

    # Execute
    print("[4] Executing LangGraph ...\n")
    t0 = time.time()
    final_state = app.invoke(initial_state)
    elapsed = time.time() - t0

    # Execution log
    print_execution_summary(final_state.get("execution_log", []))
    print(f"\n  Total execution time: {elapsed:.2f}s")

    # Itinerary
    if final_state.get("itinerary"):
        print_itinerary(final_state["itinerary"])
    else:
        print("\n[ERROR] Itinerary could not be assembled — check execution log.")

    # Save JSON
    with open("itinerary_output.json", "w", encoding="utf-8") as f:
        json.dump(final_state["itinerary"], f, indent=2, ensure_ascii=False)

    print("Itinerary JSON saved  --> itinerary_output.json")
    print("Graph PNG saved       --> trip_planner_graph.png\n")


if __name__ == "__main__":
    main()
