export type StyleCardOption = "cinematic" | "anime" | "low-poly" | "realistic";
export type MoodCardOption = "epic" | "calm" | "horror";

export type ProviderChoice = {
  motion?: string;
  scene?: string;
  music?: string;
};

export type SceneResolution = {
  width: number;
  height: number;
};

export type UiChoices = {
  style_card?: StyleCardOption;
  mood_card?: MoodCardOption;
  duration_s: number;
  seed?: number;
  scene_resolution?: SceneResolution;
  providers?: ProviderChoice;
};

export type CreateJobOptions = {
  ui_choices: UiChoices;
};

export const DEFAULT_SCENE_RESOLUTION: SceneResolution = { width: 2048, height: 1024 };

export const DEFAULT_PROVIDERS: ProviderChoice = {
  scene: "diffusion360",
  motion: "animationgpt",
  music: "musicgpt",
};

export const createDefaultOptions = (): CreateJobOptions => ({
  ui_choices: {
    duration_s: 12,
    scene_resolution: { ...DEFAULT_SCENE_RESOLUTION },
    providers: { ...DEFAULT_PROVIDERS },
  },
});
