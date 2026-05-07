"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./page.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

interface Meal {
  day: number;
  meal: string;
  time: string;
  name: string;
  cuisine: string;
  price_range: string;
  speciality: string;
}

interface Activity {
  day: number;
  slot: number;
  name: string;
  type: string;
  duration_hrs: number;
  entry_fee: string;
  best_time: string;
  description: string;
}

interface Homestay {
  name: string;
  type: string;
  rating: number;
  price_per_night: number;
  amenities: string[];
  hosts: string;
  highlights: string;
  contact: string;
}

interface DayPlan {
  meals: Meal[];
  activities: Activity[];
  accommodation: Homestay;
}

interface WeatherDay {
  date: string;
  emoji: string;
  label: string;
  temp_max: number;
  temp_min: number;
  precipitation_mm: number;
  wind_kmh: number;
}

interface WeatherData {
  location: string;
  days: WeatherDay[];
  source: string;
}

interface Itinerary {
  trip_summary: {
    destination: string;
    origin: string;
    num_days: number;
    num_travellers: number;
  };
  travel_route: {
    total_distance_km: number;
    estimated_drive_hours: number;
    highway: string;
    departure_time: string;
    arrival_time: string;
    fuel_stops: string[];
    rest_stops: Array<{ name: string; suggested_break: string; type: string }>;
    source?: string;
  };
  days: { [key: string]: DayPlan };
  all_homestay_options: Homestay[];
  weather?: WeatherData;
}

type MessageType = "user" | "ai" | "typing" | "itinerary" | "error";

interface Message {
  id: string;
  type: MessageType;
  text?: string;
  itinerary?: Itinerary;
  timestamp: Date;
  steps?: string[];
  currentStep?: number;
}

// ── Step names for progress display ────────────────────────────────────────
const STEPS = [
  { label: "Initialize", icon: "🚀" },
  { label: "Plan Route", icon: "🛣️" },
  { label: "Restaurants", icon: "🍽️" },
  { label: "Homestays", icon: "🏡" },
  { label: "Attractions", icon: "🏔️" },
  { label: "Validate", icon: "✅" },
  { label: "Assemble", icon: "📋" },
];

// ── Quick prompts ────────────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  { icon: "🌿", title: "Plan Coorg Trip", desc: "3 days from Bengaluru", prompt: "Plan a 3-day family trip to Coorg from Bengaluru for 4 people." },
  { icon: "🏔️", title: "Mountain Escape", desc: "Family adventure trip", prompt: "Plan a 3-day trip to Coorg for 4 people with outdoor activities." },
  { icon: "🌊", title: "Nature & Wildlife", desc: "Explore national parks", prompt: "Plan a 3-day family trip to Coorg focusing on wildlife and nature." },
  { icon: "☕", title: "Coffee Plantation", desc: "Cultural experience", prompt: "Plan a 3-day family trip to Coorg with coffee plantation experiences." },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatTime(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function starsDisplay(rating: number) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(5 - full - (half ? 1 : 0));
}

// ── Parse user intent ────────────────────────────────────────────────────────
function parseIntent(text: string) {
  const daysMatch = text.match(/(\d+)\s*(?:day|days)/i);
  const peopleMatch = text.match(/(\d+)\s*(?:person|people|pax|travell?er)/i);
  const destMatch = text.match(/(?:to|visit|trip to|going to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
  const originMatch = text.match(/(?:from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);

  return {
    destination: destMatch ? destMatch[1] : "Coorg, Karnataka",
    origin: originMatch ? originMatch[1] : "Bengaluru",
    num_days: daysMatch ? parseInt(daysMatch[1]) : 3,
    num_people: peopleMatch ? parseInt(peopleMatch[1]) : 4,
  };
}

// ── ItineraryView Component ──────────────────────────────────────────────────
function ItineraryView({ itinerary }: { itinerary: Itinerary }) {
  const [activeTab, setActiveTab] = useState("overview");
  const { trip_summary: ts, travel_route: tr, days, all_homestay_options: homestays, weather } = itinerary;
  const dayKeys = Object.keys(days);
  const tabs = ["overview", "route", ...(weather ? ["weather"] : []), ...dayKeys.map((d) => d), "homestays"];

  const totalActivities = dayKeys.reduce((acc, k) => acc + days[k].activities.length, 0);
  const totalMeals = dayKeys.reduce((acc, k) => acc + days[k].meals.length, 0);

  return (
    <div className={styles.itineraryCard}>
      <div className={styles.itineraryHeader}>
        <span style={{ fontSize: 28 }}>🗺️</span>
        <div>
          <div className={styles.itineraryTitle}>
            {ts.origin} → {ts.destination}
          </div>
          <div className={styles.itineraryMeta}>
            {ts.num_days} Days · {ts.num_travellers} Travellers · LangGraph Orchestrated
          </div>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{ts.num_days}</div>
          <div className={styles.statLabel}>Days</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{totalMeals}</div>
          <div className={styles.statLabel}>Meals</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{totalActivities}</div>
          <div className={styles.statLabel}>Activities</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{homestays.length}</div>
          <div className={styles.statLabel}>Stays</div>
        </div>
        <div className={styles.statItem}>
          <div className={styles.statValue}>{tr.total_distance_km}</div>
          <div className={styles.statLabel}>KM</div>
        </div>
      </div>

      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.active : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "overview" ? "📊 Overview"
              : tab === "route" ? "🛣️ Route"
              : tab === "weather" ? "🌤️ Weather"
              : tab === "homestays" ? "🏡 Stays"
              : `${tab}`}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === "overview" && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
              Your personalized <strong style={{ color: "var(--text-primary)" }}>{ts.num_days}-day family itinerary</strong> from{" "}
              <strong style={{ color: "var(--accent-secondary)" }}>{ts.origin}</strong> to{" "}
              <strong style={{ color: "var(--accent-secondary)" }}>{ts.destination}</strong> is ready!
              The LangGraph pipeline ran parallel agents for restaurants, homestays, and attractions simultaneously.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {dayKeys.map((dk) => (
                <div key={dk} onClick={() => setActiveTab(dk)}
                  style={{ padding: "12px 14px", borderRadius: "var(--radius-md)", background: "var(--bg-hover)",
                    border: "1px solid var(--border-subtle)", cursor: "pointer" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-secondary)", marginBottom: 6 }}>{dk}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {days[dk].activities.length} activities · {days[dk].meals.length} meals
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>
                    {days[dk].activities[0]?.name}
                    {days[dk].activities.length > 1 ? ` +${days[dk].activities.length - 1} more` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "route" && (
          <div className={styles.routeInfo}>
            <div className={styles.routeRow}>
              <span className={styles.routeIcon}>🛣️</span>
              <div>
                <div className={styles.routeLabel}>Highway</div>
                <div className={styles.routeValue}>{tr.highway}</div>
              </div>
            </div>
            <div className={styles.routeRow}>
              <span className={styles.routeIcon}>📏</span>
              <div>
                <div className={styles.routeLabel}>Distance / Duration</div>
                <div className={styles.routeValue}>{tr.total_distance_km} km · {tr.estimated_drive_hours} hrs</div>
              </div>
            </div>
            <div className={styles.routeRow}>
              <span className={styles.routeIcon}>⏰</span>
              <div>
                <div className={styles.routeLabel}>Depart → Arrive</div>
                <div className={styles.routeValue}>{tr.departure_time} → {tr.arrival_time}</div>
              </div>
            </div>
            <div className={styles.routeRow}>
              <span className={styles.routeIcon}>⛽</span>
              <div>
                <div className={styles.routeLabel}>Fuel Stops</div>
                <div style={{ marginTop: 4 }}>
                  {tr.fuel_stops.map((s, i) => (
                    <span key={i} className={styles.stopChip}>⛽ {s}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.routeRow}>
              <span className={styles.routeIcon}>☕</span>
              <div>
                <div className={styles.routeLabel}>Rest Stops</div>
                <div style={{ marginTop: 4 }}>
                  {tr.rest_stops.map((s, i) => (
                    <span key={i} className={styles.stopChip}>🕐 {s.suggested_break} · {s.name}</span>
                  ))}
                </div>
              </div>
            </div>
            {tr.source && (
              <div className={styles.routeSource}>🗺️ Data source: {tr.source}</div>
            )}
          </div>
        )}

        {activeTab === "weather" && weather && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.6 }}>
              📍 <strong style={{ color: "var(--text-primary)" }}>{weather.location}</strong> — {weather.days.length}-day forecast
            </div>
            <div className={styles.weatherGrid}>
              {weather.days.map((d, i) => {
                const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
                return (
                  <div key={i} className={`${styles.weatherCard} ${i === 0 ? styles.today : ""}`}>
                    <div className={styles.weatherEmoji}>{d.emoji}</div>
                    <div className={styles.weatherDate}>{label}</div>
                    <div className={styles.weatherLabel}>{d.label}</div>
                    <div className={styles.weatherTemps}>
                      <span className={styles.tempHigh}>{d.temp_max}°</span>
                      <span className={styles.tempLow}>{d.temp_min}°</span>
                    </div>
                    <div className={styles.weatherMeta}>
                      <span>💧 {d.precipitation_mm} mm</span>
                      <span>💨 {d.wind_kmh} km/h</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={styles.weatherSource}>🌍 Data source: {weather.source} · Free, no API key required</div>
          </div>
        )}

        {dayKeys.map((dk) =>
          activeTab === dk ? (
            <div key={dk}>
              <div className={styles.dayHeader}>🍽️ Meals</div>
              {days[dk].meals.map((m, i) => (
                <div key={i} className={styles.mealItem}>
                  <div className={styles.mealTime}>{m.time}</div>
                  <span className={styles.mealBadge}>{m.meal}</span>
                  <div>
                    <div className={styles.mealName}>{m.name}</div>
                    <div className={styles.mealDetail}>{m.cuisine} · {m.price_range}</div>
                    <div className={styles.mealDetail} style={{ fontStyle: "italic", marginTop: 2 }}>"{m.speciality}"</div>
                  </div>
                </div>
              ))}
              <div className={styles.dayHeader} style={{ marginTop: 16 }}>🏔️ Activities</div>
              {days[dk].activities.map((a, i) => (
                <div key={i} className={styles.activityItem}>
                  <div className={styles.activityName}>{a.name}</div>
                  <div className={styles.activityMeta}>
                    <span className={styles.activityTag}>⏱ {a.duration_hrs}h</span>
                    <span className={styles.activityTag}>🎫 {a.entry_fee}</span>
                    <span className={styles.activityTag}>🌅 {a.best_time}</span>
                    <span className={styles.activityTag}>{a.type}</span>
                  </div>
                  <div className={styles.activityDesc}>{a.description}</div>
                </div>
              ))}
            </div>
          ) : null
        )}

        {activeTab === "homestays" && (
          <div>
            {homestays.map((h, i) => (
              <div key={i} className={styles.homestayCard}>
                <div className={styles.homestayTop}>
                  <div>
                    <div className={styles.homestayName}>
                      {i === 0 && <span style={{ fontSize: 10, background: "rgba(108,99,255,0.2)", color: "var(--accent-secondary)", padding: "1px 6px", borderRadius: 999, marginRight: 6 }}>⭐ TOP PICK</span>}
                      {h.name}
                    </div>
                    <div className={styles.homestayType}>{h.type}</div>
                  </div>
                  <div className={styles.homestayPrice}>Rs.{h.price_per_night.toLocaleString()}/night</div>
                </div>
                <div className={styles.ratingRow}>
                  <span className={styles.stars}>{starsDisplay(h.rating)}</span>
                  <span className={styles.ratingVal}>{h.rating} · Hosts: {h.hosts}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>{h.highlights}</div>
                <div className={styles.amenityList}>
                  {h.amenities.slice(0, 5).map((a, j) => (
                    <span key={j} className={styles.amenityTag}>{a}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stepIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const autoGrow = () => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    }
  };

  const startStepAnimation = useCallback(() => {
    let step = 0;
    setCurrentStep(0);
    stepIntervalRef.current = setInterval(() => {
      step += 1;
      if (step >= STEPS.length) {
        if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
        return;
      }
      setCurrentStep(step);
    }, 350);
  }, []);

  const stopStepAnimation = useCallback(() => {
    if (stepIntervalRef.current) clearInterval(stepIntervalRef.current);
    setCurrentStep(STEPS.length); // all done
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      type: "user",
      text: text.trim(),
      timestamp: new Date(),
    };

    const typingMsg: Message = {
      id: crypto.randomUUID(),
      type: "typing",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, typingMsg]);
    setInput("");
    setLoading(true);
    startStepAnimation();

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const intent = parseIntent(text);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });

      const data = await res.json();
      stopStepAnimation();

      // Remove typing indicator
      setMessages((prev) => prev.filter((m) => m.type !== "typing"));

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "error",
            text: `⚠️ ${data.error}`,
            timestamp: new Date(),
          },
        ]);
      } else {
        const aiText =
          `Here's your **${intent.num_days}-day family itinerary** from **${intent.origin}** to **${intent.destination}**! ` +
          `The LangGraph pipeline orchestrated 7 agents — routing, restaurants, homestays, and attractions ran in parallel. ` +
          `Explore the tabs below to see every detail.`;

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            type: "itinerary",
            text: aiText,
            itinerary: data.itinerary,
            timestamp: new Date(),
          },
        ]);
      }
    } catch {
      stopStepAnimation();
      setMessages((prev) => prev.filter((m) => m.type !== "typing"));
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: "error",
          text: "⚠️ Failed to reach the trip planner. Make sure the Python venv is set up correctly.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      setCurrentStep(-1);
    }
  }, [loading, startStepAnimation, stopStepAnimation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.ambientBg} />

      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <div className={styles.logoIcon}>✈️</div>
          <div>
            <div className={styles.logoText}>TripMind</div>
            <div className={styles.logoSub}>LangGraph Powered</div>
          </div>
        </div>

        <div className={styles.sidebarSection}>
          <div className={styles.sidebarLabel}>Quick Starts</div>
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              id={`quick-prompt-${i}`}
              className={styles.quickPromptBtn}
              onClick={() => sendMessage(qp.prompt)}
              disabled={loading}
            >
              <span className={styles.promptIcon}>{qp.icon}</span>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 1 }}>{qp.title}</div>
                <div>{qp.desc}</div>
              </div>
            </button>
          ))}

          <div className={styles.sidebarLabel} style={{ marginTop: 24 }}>Graph Nodes</div>
          {STEPS.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", fontSize: 12, color: "var(--text-muted)" }}>
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <div className={styles.sidebarFooter}>
          <div className={styles.statusBadge}>
            <div className={styles.statusDot} />
            LangGraph v0.3 · Python 3.14
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        <div className={styles.topBar}>
          <div>
            <div className={styles.topBarTitle}>Family Trip Planner</div>
            <div className={styles.topBarMeta}>Multi-agent orchestration with parallel execution</div>
          </div>
          <div className={styles.modelBadge}>
            <span>⚡</span> LangGraph · 7 Nodes
          </div>
        </div>

        <div className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🌿</div>
              <h1 className={styles.emptyTitle}>Plan Your Perfect Trip</h1>
              <p className={styles.emptySubtitle}>
                Describe your dream trip and TripMind will orchestrate a personalized
                itinerary using LangGraph's multi-agent pipeline — routes, restaurants,
                homestays, and attractions all in one go.
              </p>
              <div className={styles.suggestionGrid}>
                {QUICK_PROMPTS.map((qp, i) => (
                  <button
                    key={i}
                    id={`suggestion-card-${i}`}
                    className={styles.suggestionCard}
                    onClick={() => sendMessage(qp.prompt)}
                    disabled={loading}
                  >
                    <span className={styles.suggestionEmoji}>{qp.icon}</span>
                    <div className={styles.suggestionTitle}>{qp.title}</div>
                    <div className={styles.suggestionDesc}>{qp.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            if (msg.type === "typing") {
              return (
                <div key={msg.id} className={styles.typingRow}>
                  <div className={`${styles.avatar} ${styles.ai}`}>✈️</div>
                  <div>
                    <div className={styles.typingBubble}>
                      <div className={styles.typingDots}>
                        <span /><span /><span />
                      </div>
                      <span className={styles.typingLabel}>Orchestrating your trip…</span>
                    </div>
                    {currentStep >= 0 && (
                      <div className={styles.stepsRow}>
                        {STEPS.map((s, i) => (
                          <span
                            key={i}
                            className={`${styles.stepChip} ${
                              i < currentStep ? styles.done : i === currentStep ? styles.active : styles.pending
                            }`}
                          >
                            {s.icon} {s.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            if (msg.type === "user") {
              return (
                <div key={msg.id} className={`${styles.messageRow} ${styles.user}`}>
                  <div className={styles.messageBubble + " " + styles.user}>
                    {msg.text}
                  </div>
                  <div className={`${styles.avatar} ${styles.user}`}>👤</div>
                </div>
              );
            }

            if (msg.type === "itinerary" || msg.type === "ai") {
              return (
                <div key={msg.id} className={styles.messageRow}>
                  <div className={`${styles.avatar} ${styles.ai}`}>✈️</div>
                  <div style={{ flex: 1, maxWidth: "80%" }}>
                    <div className={`${styles.messageBubble} ${styles.ai}`}>{msg.text}</div>
                    {msg.itinerary && <ItineraryView itinerary={msg.itinerary} />}
                    <div className={styles.messageTime}>{formatTime(msg.timestamp)}</div>
                  </div>
                </div>
              );
            }

            if (msg.type === "error") {
              return (
                <div key={msg.id} className={styles.messageRow}>
                  <div className={`${styles.avatar} ${styles.ai}`}>⚠️</div>
                  <div>
                    <div className={`${styles.messageBubble} ${styles.ai}`} style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--accent-red)" }}>
                      {msg.text}
                    </div>
                    <div className={styles.messageTime}>{formatTime(msg.timestamp)}</div>
                  </div>
                </div>
              );
            }
          })}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className={styles.inputArea}>
          <div className={styles.inputRow}>
            <textarea
              id="chat-input"
              ref={textareaRef}
              className={styles.inputBox}
              placeholder="Plan a 3-day family trip to Coorg from Bengaluru…"
              value={input}
              onChange={(e) => { setInput(e.target.value); autoGrow(); }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={loading}
            />
            <button
              id="send-btn"
              className={styles.sendBtn}
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              {loading ? "⏳" : "➤"}
            </button>
          </div>
          <div className={styles.inputHint}>
            Press <strong>Enter</strong> to send · <strong>Shift+Enter</strong> for new line · Results powered by LangGraph
          </div>
        </div>
      </main>
    </div>
  );
}
