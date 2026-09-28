import z from "@deepseek-ai/schemastery";
//#region src/core/config.ts
const DEFAULT_SETTINGS = {
	language: "zh",
	enabled: true,
	keyHeight: 2,
	keyGap: 12,
	maxVisible: 20
};
const SETTINGS_LIMITS = {
	keyHeight: {
		min: 1,
		max: 4
	},
	keyGap: {
		min: 6,
		max: 18
	},
	maxVisible: {
		min: 5,
		max: 30
	}
};
//#endregion
//#region src/index.ts
/** Keep this entry id aligned with the former settings namespace for DSH migration. */
const SETTINGS_ENTRY_ID = "sm-context-piano";
/**
* Integer range shared with the browser decoder, so profile edits and other
* settings clients are refused instead of being silently clamped client-side.
*/
const bounded = (field) => z.number().min(SETTINGS_LIMITS[field].min).max(SETTINGS_LIMITS[field].max).step(1);
const Config = z.object({
	language: z.union([
		z.const("zh"),
		z.const("en"),
		z.const("zh-TW")
	]).default(DEFAULT_SETTINGS.language).volatile(),
	enabled: z.boolean().default(DEFAULT_SETTINGS.enabled).volatile(),
	keyHeight: bounded("keyHeight").default(DEFAULT_SETTINGS.keyHeight).volatile(),
	keyGap: bounded("keyGap").default(DEFAULT_SETTINGS.keyGap).volatile(),
	maxVisible: bounded("maxVisible").default(DEFAULT_SETTINGS.maxVisible).volatile()
});
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), `sm-context-piano:${SETTINGS_ENTRY_ID}: custom settings page`);
	});
}
//#endregion
export { Config, apply };
