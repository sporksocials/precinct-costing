import localFont from "next/font/local";

/** Precinct faces (Chiobu's pairing, also used by the Precinct Desk hub). */
export const karla = localFont({ src: "./fonts/Karla-var.woff2", variable: "--font-body", weight: "200 800", display: "swap" });
export const bebas = localFont({ src: "./fonts/BebasNeue.woff2", variable: "--font-display", weight: "400", display: "swap" });

/** Venue display faces. Titles only. */
export const sailors = localFont({ src: "./fonts/SailorsCondensed.woff2", variable: "--font-drift", weight: "400", display: "swap" }); // Drift Bar (licensed)
export const hitchcut = localFont({ src: "./fonts/Hitchcut-Regular.woff2", variable: "--font-greedy", weight: "400", display: "swap" }); // Greedy Gringo's (licensed)
// Gelato Rumba's face is Borsok; it isn't in the Drive brand folder yet, so Fredoka (OFL) stands in until it is.
export const gelato = localFont({ src: "./fonts/Fredoka-600.woff2", variable: "--font-gelato", weight: "600", display: "swap" });

export const fontVars = [karla, bebas, sailors, hitchcut, gelato].map((f) => f.variable).join(" ");
