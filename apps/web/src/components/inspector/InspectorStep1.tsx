import {
  CreateJobOptions,
  DEFAULT_SCENE_RESOLUTION,
  MoodCardOption,
  StyleCardOption,
  UiChoices,
} from "../../types/options";

type InspectorStep1Props = {
  prompt: string;
  draftOptions: CreateJobOptions;
  onDraftChange: (next: CreateJobOptions) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
};

const STYLE_OPTIONS: Array<{ id: StyleCardOption; label: string; detail: string }> = [
  { id: "cinematic", label: "Cinematic", detail: "High contrast, dramatic framing." },
  { id: "anime", label: "Anime", detail: "Stylized shading, bold silhouettes." },
  { id: "low-poly", label: "Low-poly", detail: "Clean geometry, faceted shapes." },
  { id: "realistic", label: "Realistic", detail: "Natural lighting, detailed materials." },
];

const MOOD_OPTIONS: Array<{ id: MoodCardOption; label: string }> = [
  { id: "epic", label: "Epic" },
  { id: "calm", label: "Calm" },
  { id: "horror", label: "Horror" },
];

const toPositiveInt = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

const toOptionalNumber = (value: string): number | undefined => {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const InspectorStep1 = ({
  prompt,
  draftOptions,
  onDraftChange,
  onConfirm,
  isSubmitting,
}: InspectorStep1Props) => {
  const uiChoices = draftOptions.ui_choices;
  const resolution = uiChoices.scene_resolution ?? DEFAULT_SCENE_RESOLUTION;

  const updateUiChoices = (patch: Partial<UiChoices>) => {
    onDraftChange({
      ...draftOptions,
      ui_choices: {
        ...uiChoices,
        ...patch,
      },
    });
  };

  const updateProvider = (key: "motion" | "scene" | "music", value: string) => {
    const trimmed = value.trim();
    const nextProviders = { ...(uiChoices.providers ?? {}) };
    if (trimmed) {
      nextProviders[key] = trimmed;
    } else {
      delete nextProviders[key];
    }
    updateUiChoices({
      providers: Object.keys(nextProviders).length > 0 ? nextProviders : undefined,
    });
  };

  return (
    <section
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
        background: "#f9fafb",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Step 1</div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#9ca3af",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Prompt
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.4 }}>{prompt}</div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Style</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          {STYLE_OPTIONS.map((option) => {
            const isSelected = uiChoices.style_card === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateUiChoices({ style_card: option.id })}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${isSelected ? "#111827" : "#e5e7eb"}`,
                  background: isSelected ? "#111827" : "#ffffff",
                  color: isSelected ? "#f9fafb" : "#111827",
                  padding: "12px 14px",
                  minHeight: 72,
                  cursor: "pointer",
                  textAlign: "left",
                  boxShadow: isSelected ? "0 8px 18px rgba(15, 23, 42, 0.12)" : "none",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{option.label}</div>
                <div style={{ fontSize: 11, opacity: isSelected ? 0.75 : 0.6 }}>
                  {option.detail}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Mood</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {MOOD_OPTIONS.map((option) => {
            const isSelected = uiChoices.mood_card === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateUiChoices({ mood_card: option.id })}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${isSelected ? "#111827" : "#e5e7eb"}`,
                  background: isSelected ? "#111827" : "#ffffff",
                  color: isSelected ? "#f9fafb" : "#111827",
                  padding: "6px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280" }}>Duration</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>
            {uiChoices.duration_s}s
          </div>
        </div>
        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={uiChoices.duration_s}
          onChange={(event) =>
            updateUiChoices({ duration_s: Number.parseInt(event.target.value, 10) })
          }
          style={{ width: "100%" }}
        />
      </div>

      <details
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#ffffff",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: "#374151",
          }}
        >
          Advanced settings
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Scene provider</span>
              <input
                value={uiChoices.providers?.scene ?? ""}
                onChange={(event) => updateProvider("scene", event.target.value)}
                placeholder="diffusion360"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Motion provider</span>
              <input
                value={uiChoices.providers?.motion ?? ""}
                onChange={(event) => updateProvider("motion", event.target.value)}
                placeholder="animationgpt"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Music provider</span>
              <input
                value={uiChoices.providers?.music ?? ""}
                onChange={(event) => updateProvider("music", event.target.value)}
                placeholder="musicgpt"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Seed</span>
              <input
                type="number"
                value={uiChoices.seed ?? ""}
                onChange={(event) => updateUiChoices({ seed: toOptionalNumber(event.target.value) })}
                placeholder="Optional"
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Scene width</span>
              <input
                type="number"
                value={resolution.width}
                onChange={(event) =>
                  updateUiChoices({
                    scene_resolution: {
                      ...resolution,
                      width: toPositiveInt(event.target.value, resolution.width),
                    },
                  })
                }
                min={256}
                step={64}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Scene height</span>
              <input
                type="number"
                value={resolution.height}
                onChange={(event) =>
                  updateUiChoices({
                    scene_resolution: {
                      ...resolution,
                      height: toPositiveInt(event.target.value, resolution.height),
                    },
                  })
                }
                min={256}
                step={64}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
            </label>
          </div>
        </div>
      </details>

      <button
        type="button"
        onClick={onConfirm}
        disabled={isSubmitting}
        style={{
          borderRadius: 12,
          padding: "10px 16px",
          border: "none",
          background: isSubmitting ? "#e5e7eb" : "#111827",
          color: isSubmitting ? "#9ca3af" : "#f9fafb",
          cursor: isSubmitting ? "not-allowed" : "pointer",
          fontWeight: 600,
        }}
      >
        {isSubmitting ? "Starting..." : "Start generation"}
      </button>
    </section>
  );
};
