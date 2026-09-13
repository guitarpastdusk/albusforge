import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage, { metadata } from "./page";

const html = renderToStaticMarkup(<AboutPage />);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("About us page", () => {
  it("has a title and description for metadata", () => {
    expect(metadata.title).toBe("About us");
    expect(String(metadata.description)).toContain("closes the loop");
  });

  it("uses the page-title pattern: kicker and a display title", () => {
    expect(html).toMatch(/font-mono uppercase[^"]*text-coral-deep">About us</);
    expect(html).toMatch(/<h1 class="[^"]*font-display[^"]*">Physical AI, built from a sentence<\/h1>/);
    expect(text).toContain("One question in. A working device out, and an AI cloud that closes the loop.");
  });

  it("opens with why we're building this, right after the hero, as three short paragraphs", () => {
    expect(html).toMatch(/font-mono uppercase[^"]*text-coral-deep">Why we’re building this</);
    expect(html).toMatch(/<h2 id="why" class="[^"]*font-display[^"]*">Physical AI should be something anyone can build\.<\/h2>/);
    expect(text).toContain("We think a plain sentence should be enough.");
    expect(text).toContain("every device we generate closes the loop.");
    expect(text).toContain("a person in charge of every action.");
    const why = html.indexOf('id="why"');
    expect(why).toBeGreaterThan(html.indexOf("<h1"));
    expect(why).toBeLessThan(html.indexOf('id="what-we-build"'));
    expect(html.slice(why, html.indexOf('id="what-we-build"')).match(/<p>/g)).toHaveLength(3);
  });

  it("renders its sections", () => {
    for (const heading of ["What we build", "The closed loop", "Our principles", "Team"]) expect(text).toContain(heading);
    for (const step of ["A real parts cart", "A 3D-printable enclosure", "Working firmware", "A kit", "Live in the cloud"]) expect(text).toContain(step);
  });

  it("shows the five loop steps in order", () => {
    const order = ["Sense", "Detect", "Reason", "Act", "Confirm"].map((step) => html.indexOf(`>${step}</h3>`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lists the principles, linking the Security pledge", () => {
    expect(text).toContain("One curated part registry drives everything.");
    expect(text).toContain("Every number comes from the data, never from the model.");
    expect(text).toContain("Actions a model proposes need a person, or a policy, to confirm them.");
    expect(text).toContain("Own your data.");
    expect(text).toContain("Parts, firmware and enclosure ship as a kit.");
    expect(html).toMatch(/href="\/security"[^>]*>Security pledge</);
  });

  it("introduces Team Albus with sourced wording only, no contact details, and links to start a build", () => {
    expect(text).toContain("Team Albus");
    expect(text).toContain("Sukrit Dasgupta");
    expect(text).toContain("Solo hacker, Team Albus");
    expect(text).toContain("Being built at MIT");
    for (const unsourced of ["Founder", "founder", "building at MIT", "readings are yours", "One sentence is the brief"]) expect(text).not.toContain(unsourced);
    expect(text).toContain("Battle of the Coasts");
    expect(text).toContain("Deep Tech / Physical AI");
    expect(html).not.toMatch(/@|mailto:|tel:/);
    expect(html).toMatch(/href="\/"[^>]*>Start a build →/);
    expect(html).toContain('href="/signup"');
  });
});
