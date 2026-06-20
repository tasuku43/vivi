export type MermaidPreviewTheme = "light" | "dark";

export function viviMermaidThemeVariables(theme: MermaidPreviewTheme) {
  if (theme === "light") {
    return {
      background: "#fbfaf7",
      mainBkg: "#ffffff",
      primaryColor: "#ffffff",
      primaryBorderColor: "#2f6f73",
      primaryTextColor: "#172426",
      secondaryColor: "#fff7d6",
      tertiaryColor: "#eef7f4",
      lineColor: "#2f6f73",
      textColor: "#172426",
      clusterBkg: "#f2f0ea",
      clusterBorder: "#d4c9b8",
      noteBkgColor: "#fff7d6",
      noteTextColor: "#172426",
      actorBkg: "#ffffff",
      actorBorder: "#2f6f73",
      actorTextColor: "#172426",
      signalColor: "#2f6f73",
      labelBoxBkgColor: "#ffffff",
      labelBoxBorderColor: "#d4c9b8",
      labelTextColor: "#172426",
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    };
  }

  return {
    background: "#0e1316",
    mainBkg: "#152126",
    primaryColor: "#152126",
    primaryBorderColor: "#7dd3c7",
    primaryTextColor: "#edf7f5",
    secondaryColor: "#2f2a1b",
    tertiaryColor: "#172c2d",
    lineColor: "#7dd3c7",
    textColor: "#edf7f5",
    clusterBkg: "#11191d",
    clusterBorder: "#34474d",
    noteBkgColor: "#2f2a1b",
    noteTextColor: "#f8e7a5",
    actorBkg: "#152126",
    actorBorder: "#7dd3c7",
    actorTextColor: "#edf7f5",
    signalColor: "#7dd3c7",
    labelBoxBkgColor: "#11191d",
    labelBoxBorderColor: "#34474d",
    labelTextColor: "#edf7f5",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };
}
