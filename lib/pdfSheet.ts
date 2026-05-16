import { jsPDF } from "jspdf";
import { Character } from "./traveller/character";
import { BLADES, GUNS } from "./traveller/cascades";
import { formatBenefit } from "./traveller/sheet";
import { getEdition } from "./traveller/editions";
import { numCommaSep } from "./traveller/formatting";

// Pistols are the prefix of the GUNS pool; deriving from the shared constant
// keeps the two definitions from drifting.
const PISTOLS = new Set<string>(GUNS.filter((g: string) => g.endsWith("Pistol") || g === "Revolver"));
const BLADE_SET = new Set<string>(BLADES);

// Letter, in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const X0 = MARGIN;
const W = PAGE_W - 2 * MARGIN; // 540

const LINE = 0.7;
const BOLD = "helvetica";

// Combining diacritical marks block (U+0300..U+036F). Built from a string
// literal with Unicode escapes so the regex is robust against editor
// normalization (a literal /[̀-ͯ]/ would break if anyone normalized the file).
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036F]", "g");

export function safeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-zA-Z0-9-_. ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function drawCheckbox(doc: jsPDF, x: number, y: number, checked: boolean) {
  doc.rect(x, y, 8, 8);
  if (checked) {
    const prev = doc.getLineWidth();
    doc.setLineWidth(1.2);
    doc.line(x, y, x + 8, y + 8);
    doc.line(x + 8, y, x, y + 8);
    doc.setLineWidth(prev);
  }
}

function fieldLabel(doc: jsPDF, x: number, y: number, text: string, italicTail?: string) {
  doc.setFont(BOLD, "normal");
  doc.setFontSize(7.5);
  doc.text(text, x, y);
  if (italicTail) {
    const w = doc.getTextWidth(text);
    doc.setFont(BOLD, "italic");
    doc.setFontSize(7);
    doc.text(italicTail, x + w + 2, y);
    doc.setFont(BOLD, "normal");
  }
}

function fieldValue(doc: jsPDF, x: number, y: number, text: string, maxW: number, size = 11) {
  if (!text) return;
  doc.setFont("courier", "normal");
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, maxW);
  doc.text(lines, x, y);
  doc.setFont(BOLD, "normal");
}

function sectionBar(doc: jsPDF, x: number, y: number, w: number, h: number, title: string) {
  doc.rect(x, y, w, h);
  doc.setFont(BOLD, "bold");
  doc.setFontSize(15);
  doc.text(title, x + 8, y + h - 9);
  doc.setFont(BOLD, "normal");
}

export function splitSkills(skills: ReadonlyArray<readonly [string, number]>) {
  const sorted = [...skills].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return {
    primary: sorted[0] ? `${sorted[0][0]}-${sorted[0][1]}` : "",
    secondary: sorted[1] ? `${sorted[1][0]}-${sorted[1][1]}` : "",
    rest: sorted.slice(2).map(([n, l]) => `${n}-${l}`),
  };
}

export function highestSkillIn(
  skills: ReadonlyArray<readonly [string, number]>,
  pool: Set<string>,
): string {
  let best: readonly [string, number] | null = null;
  for (const sk of skills) {
    if (!pool.has(sk[0])) continue;
    if (!best || sk[1] > best[1] || (sk[1] === best[1] && sk[0] < best[0])) best = sk;
  }
  return best ? `${best[0]}-${best[1]}` : "";
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function drawTasForm2(doc: jsPDF, c: Character): number {
  doc.setLineWidth(LINE);
  let y = MARGIN;

  // ─── PERSONAL DATA AND HISTORY header row ───
  sectionBar(doc, X0, y, 360, 28, "PERSONAL DATA AND HISTORY");
  doc.rect(X0 + 360, y, 180, 28);
  fieldLabel(doc, X0 + 364, y + 10, "1. Date of Preparation");
  fieldValue(doc, X0 + 366, y + 23, todayLocal(), 170, 10);
  y += 28;

  // Row: Name | UPP
  const nameH = 36;
  doc.rect(X0, y, 280, nameH);
  fieldLabel(doc, X0 + 4, y + 10, "2. Name");
  fieldValue(doc, X0 + 6, y + 28, c.name, 272);

  doc.rect(X0 + 280, y, 260, nameH);
  fieldLabel(doc, X0 + 284, y + 10, "3. UPP");
  const upp = c.getAttrString();
  const statNames = ["Stren", "Dext", "Endur", "Intel", "Educ", "Soc"];
  const uppLabelW = 50;
  const statW = (260 - uppLabelW) / 6;
  const statX0 = X0 + 280 + uppLabelW;
  doc.setFont(BOLD, "italic");
  doc.setFontSize(8);
  for (let i = 0; i < 6; i++) {
    doc.text(statNames[i]!, statX0 + i * statW + 4, y + 10);
  }
  doc.setFont("courier", "normal");
  doc.setFontSize(16);
  for (let i = 0; i < 6; i++) {
    const ch = upp[i] || "";
    const cw = doc.getTextWidth(ch);
    doc.text(ch, statX0 + i * statW + statW / 2 - cw / 2, y + 30);
  }
  doc.setFont(BOLD, "normal");
  y += nameH;

  // Row: Noble Title | Military Rank | Birthdate
  const r3H = 32;
  doc.rect(X0, y, 160, r3H);
  fieldLabel(doc, X0 + 4, y + 10, "4. Noble Title");
  fieldValue(doc, X0 + 6, y + 26, c.getNobleTitle(), 152);

  doc.rect(X0 + 160, y, 160, r3H);
  fieldLabel(doc, X0 + 164, y + 10, "5. Military Rank");
  const rankText = c.serviceDef().ranks[c.rank] || "";
  fieldValue(doc, X0 + 166, y + 26, rankText, 152);

  doc.rect(X0 + 320, y, 220, r3H);
  fieldLabel(doc, X0 + 324, y + 10, "6. Birthdate");
  y += r3H;

  // Row: Age Modifiers | Birthworld
  const r4H = 32;
  doc.rect(X0, y, 360, r4H);
  fieldLabel(doc, X0 + 4, y + 10, "7. Age Modifiers", "(+ for drugs; - for sleep)");
  fieldValue(doc, X0 + 6, y + 26, `Age ${c.age}`, 352);

  doc.rect(X0 + 360, y, 180, r4H);
  fieldLabel(doc, X0 + 364, y + 10, "8. Birthworld");
  if (c.homeworld) {
    const hw = c.homeworld;
    fieldValue(doc, X0 + 366, y + 23,
      `${hw.starport}${hw.size[0]}${hw.atmosphere[0]} ${hw.tech}`, 172, 8);
  }
  y += r4H;

  // ─── SERVICE HISTORY header row ───
  sectionBar(doc, X0, y, 260, 30, "SERVICE HISTORY");
  doc.rect(X0 + 260, y, 280, 30);
  doc.setFont(BOLD, "italic");
  doc.setFontSize(7.5);
  doc.text("Personal service data produced from the appropriate", X0 + 264, y + 13);
  doc.text("character generation system.", X0 + 264, y + 24);
  doc.setFont(BOLD, "normal");
  y += 30;

  // Row: Service | Branch | Dischargeworld
  doc.rect(X0, y, 180, r3H);
  fieldLabel(doc, X0 + 4, y + 10, "9. Service");
  fieldValue(doc, X0 + 6, y + 26, c.serviceDef().serviceName, 172);

  doc.rect(X0 + 180, y, 140, r3H);
  fieldLabel(doc, X0 + 184, y + 10, "10. Branch");
  if (c.drafted) fieldValue(doc, X0 + 186, y + 26, "Drafted", 132);

  doc.rect(X0 + 320, y, 220, r3H);
  fieldLabel(doc, X0 + 324, y + 10, "11. Dischargeworld");
  y += r3H;

  // Row: Terms | Final Rank | Retired? | Retirement Pay
  doc.rect(X0, y, 130, r3H);
  fieldLabel(doc, X0 + 4, y + 10, "12. Terms Served");
  fieldValue(doc, X0 + 6, y + 26, String(c.terms), 122);

  doc.rect(X0 + 130, y, 130, r3H);
  fieldLabel(doc, X0 + 134, y + 10, "13. Final Rank");
  fieldValue(doc, X0 + 136, y + 26, rankText, 122);

  doc.rect(X0 + 260, y, 130, r3H);
  fieldLabel(doc, X0 + 264, y + 10, "14a. Retired?");
  drawCheckbox(doc, X0 + 268, y + 20, c.retired);
  doc.setFont(BOLD, "normal");
  doc.setFontSize(8);
  doc.text("Yes", X0 + 280, y + 27);
  drawCheckbox(doc, X0 + 308, y + 20, !c.retired);
  doc.text("No", X0 + 320, y + 27);

  doc.rect(X0 + 390, y, 150, r3H);
  fieldLabel(doc, X0 + 394, y + 10, "14b. Retirement Pay");
  if (c.retirementPay > 0)
    fieldValue(doc, X0 + 396, y + 26, `Cr${numCommaSep(c.retirementPay)}/yr`, 142);
  y += r3H;

  // 15. Special Assignments
  doc.rect(X0, y, W, 50);
  fieldLabel(doc, X0 + 4, y + 10, "15. Special Assignments");
  const assignments: string[] = [];
  if (c.commissioned) assignments.push("Commissioned officer");
  if (c.ship) assignments.push("Starship benefit awarded");
  if (assignments.length > 0)
    fieldValue(doc, X0 + 6, y + 26, assignments.join("; "), W - 12);
  y += 50;

  // 16. Awards and Decorations
  doc.rect(X0, y, W, 50);
  fieldLabel(
    doc,
    X0 + 4,
    y + 10,
    "16. Awards and Decorations",
    "(include Combat Command Credits, Commendations, Medals, etc)",
  );
  y += 50;

  // 17. Equipment Qualified On
  doc.rect(X0, y, W, 44);
  fieldLabel(doc, X0 + 4, y + 10, "17. Equipment Qualified On");
  const equipment: string[] = [];
  for (const [n] of c.skills) {
    if (
      n === "ATV" || n === "Air/Raft" || n === "Vacc Suit" || n === "Ship's Boat" ||
      n === "Battle Dress" || n.includes("Aircraft") || n.includes("Watercraft") ||
      n === "Helicopter" || n === "Hovercraft" || n === "Submersible" ||
      n === "Tracked Vehicle" || n === "Wheeled Vehicle" || n === "Grav Vehicle" ||
      n === "Pilot" || n === "Gunnery"
    ) {
      equipment.push(n);
    }
  }
  if (equipment.length > 0)
    fieldValue(doc, X0 + 6, y + 26, equipment.join(", "), W - 12, 10);
  y += 44;

  // 18a / 18b
  const { primary, secondary, rest } = splitSkills(c.skills);
  doc.rect(X0, y, W / 2, 30);
  fieldLabel(doc, X0 + 4, y + 10, "18a. Primary Skill");
  fieldValue(doc, X0 + 6, y + 25, primary, W / 2 - 12);

  doc.rect(X0 + W / 2, y, W / 2, 30);
  fieldLabel(doc, X0 + W / 2 + 4, y + 10, "18b. Secondary Skill");
  fieldValue(doc, X0 + W / 2 + 6, y + 25, secondary, W / 2 - 12);
  y += 30;

  // 18c. Additional Skills
  doc.rect(X0, y, W, 80);
  fieldLabel(doc, X0 + 4, y + 10, "18c. Additional Skills");
  if (rest.length > 0)
    fieldValue(doc, X0 + 6, y + 26, rest.join(", "), W - 12, 11);
  y += 80;

  // 19a / 19b / 19c / 20
  const r19H = 36;
  doc.rect(X0, y, 135, r19H);
  fieldLabel(doc, X0 + 4, y + 10, "19a. Preferred Weapon");
  fieldValue(doc, X0 + 6, y + 28, c.gunBenefit, 127);

  doc.rect(X0 + 135, y, 135, r19H);
  fieldLabel(doc, X0 + 139, y + 10, "19b. Preferred Pistol");
  fieldValue(doc, X0 + 141, y + 28, highestSkillIn(c.skills, PISTOLS), 127);

  doc.rect(X0 + 270, y, 135, r19H);
  fieldLabel(doc, X0 + 274, y + 10, "19c. Preferred Blade");
  fieldValue(doc, X0 + 276, y + 28, c.bladeBenefit || highestSkillIn(c.skills, BLADE_SET), 127);

  doc.rect(X0 + 405, y, 135, r19H);
  fieldLabel(doc, X0 + 409, y + 10, "20. Travellers' Member?");
  drawCheckbox(doc, X0 + 413, y + 22, c.TAS);
  doc.setFont(BOLD, "normal");
  doc.setFontSize(8);
  doc.text("Yes", X0 + 425, y + 29);
  drawCheckbox(doc, X0 + 453, y + 22, !c.TAS);
  doc.text("No", X0 + 465, y + 29);
  y += r19H;

  // ─── PSIONICS header row ───
  sectionBar(doc, X0, y, 130, 30, "PSIONICS");
  doc.rect(X0 + 130, y, W - 130, 30);
  doc.setFont(BOLD, "italic");
  doc.setFontSize(7);
  doc.text(
    "Warning: Information regarding an individual's psionic ability is confidential,",
    X0 + 134,
    y + 13,
  );
  doc.text(
    "and may not be released without his or her consent.",
    X0 + 134,
    y + 23,
  );
  doc.setFont(BOLD, "normal");
  y += 30;

  // Row: Date of Test | PSR | Trained? | Date Completed
  doc.rect(X0, y, 135, r3H);
  fieldLabel(doc, X0 + 4, y + 10, "21. Date of Test");

  doc.rect(X0 + 135, y, 135, r3H);
  fieldLabel(doc, X0 + 139, y + 10, "22. PSR");

  doc.rect(X0 + 270, y, 135, r3H);
  fieldLabel(doc, X0 + 274, y + 10, "23a. Trained?");
  // No psionics test is performed by the generator — leave both boxes blank
  // rather than asserting "No" on a test that never happened.
  drawCheckbox(doc, X0 + 278, y + 20, false);
  doc.setFont(BOLD, "normal");
  doc.setFontSize(8);
  doc.text("Yes", X0 + 290, y + 27);
  drawCheckbox(doc, X0 + 320, y + 20, false);
  doc.text("No", X0 + 332, y + 27);

  doc.rect(X0 + 405, y, 135, r3H);
  fieldLabel(doc, X0 + 409, y + 10, "23b. Date Completed");
  y += r3H;

  // 24. Talents and Current Levels
  doc.rect(X0, y, W, 50);
  fieldLabel(doc, X0 + 4, y + 10, "24. Talents and Current Levels");
  y += 50;

  // Footer
  doc.setFont(BOLD, "bold");
  doc.setFontSize(11);
  doc.text("TAS Form 2", X0, y + 14);
  doc.setFont(BOLD, "normal");

  return y + 16;
}

function drawSupplement(doc: jsPDF, c: Character) {
  doc.addPage();
  doc.setLineWidth(LINE);
  let y = MARGIN;

  // FUNDS section
  sectionBar(doc, X0, y, W, 28, "PERSONAL FUNDS AND POSSESSIONS");
  y += 28;

  // Cash | Mustering-out passages
  doc.rect(X0, y, 200, 32);
  fieldLabel(doc, X0 + 4, y + 10, "Cash Credits");
  fieldValue(doc, X0 + 6, y + 26, `Cr${numCommaSep(c.credits)}`, 192, 12);

  doc.rect(X0 + 200, y, 340, 32);
  fieldLabel(doc, X0 + 204, y + 10, "Mustering-Out Passages");
  const PASSAGE_KINDS = ["Low Passage", "Mid Passage", "Middle Passage", "High Passage"];
  const passageCounts = new Map<string, number>();
  for (const b of c.benefits) {
    if (PASSAGE_KINDS.includes(b)) {
      passageCounts.set(b, (passageCounts.get(b) ?? 0) + 1);
    }
  }
  const passages = [...passageCounts.entries()].map(([n, c]) => (c > 1 ? `${c} ${n}` : n));
  fieldValue(doc, X0 + 206, y + 26, passages.join(", "), 332, 10);
  y += 32;

  // Ships
  doc.rect(X0, y, W, 40);
  fieldLabel(doc, X0 + 4, y + 10, "Starships and Major Possessions");
  const SHIP_NAMES = ["Free Trader", "Scout Ship", "Seeker", "Lab Ship", "Yacht", "Safari Ship", "Corsair"];
  const seenShips = new Set<string>();
  const ships: string[] = [];
  for (const b of c.benefits) {
    if (SHIP_NAMES.includes(b) && !seenShips.has(b)) {
      seenShips.add(b);
      ships.push(formatBenefit(b, c));
    }
  }
  ships.sort();
  if (ships.length > 0) fieldValue(doc, X0 + 6, y + 26, ships.join("; "), W - 12, 11);
  y += 40;

  // Other benefits (TAS, Instruments, Watch, etc.)
  doc.rect(X0, y, W, 40);
  fieldLabel(doc, X0 + 4, y + 10, "Other Benefits");
  const SHIP_KINDS = new Set([
    "Free Trader", "Scout Ship", "Seeker", "Lab Ship", "Yacht", "Safari Ship", "Corsair",
  ]);
  const otherCounts = new Map<string, number>();
  for (const b of c.benefits) {
    if (PASSAGE_KINDS.includes(b)) continue;
    if (SHIP_KINDS.has(b)) continue;
    if (b.endsWith("/yr Retirement Pay")) continue;
    otherCounts.set(b, (otherCounts.get(b) ?? 0) + 1);
  }
  const other = [...otherCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, c]) => (c > 1 ? `${c} ${n}` : n));
  if (other.length > 0) fieldValue(doc, X0 + 6, y + 26, other.join(", "), W - 12, 11);
  y += 40;

  // Service History
  y += 4;
  sectionBar(doc, X0, y, W, 28, "SERVICE HISTORY DETAIL");
  y += 28;

  doc.rect(X0, y, W, PAGE_H - MARGIN - y);
  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  const inner = W - 12;
  const yLimit = PAGE_H - MARGIN - 8;
  let cur = y + 14;
  for (const line of c.history) {
    const wrapped = doc.splitTextToSize(line, inner);
    for (const w of wrapped) {
      if (cur > yLimit) {
        doc.addPage();
        cur = MARGIN + 14;
        doc.setLineWidth(LINE);
        doc.rect(X0, MARGIN, W, PAGE_H - 2 * MARGIN);
        doc.setFont("courier", "normal");
        doc.setFontSize(10);
      }
      doc.text(w, X0 + 6, cur);
      cur += 12;
    }
  }
  doc.setFont(BOLD, "normal");
}

/** Renderer for the MT Advanced Character Generation supplement page.
 *  Drawn as an additional page after TAS Form 2 (and the basic supplement
 *  if present) when c.useAcg is true. Mirrors the MT Players' Manual
 *  Player Record Card style: shows pathway, branch, MOS, decorations,
 *  brownie points, and specialist schools alongside the standard fields.
 *
 *  Drawn as a separate page rather than overlaid on TAS Form 2 to avoid
 *  reflowing the basic sheet for ACG-specific fields that don't apply to
 *  CT or basic-MT characters. */
function drawAcgRecordSheet(doc: jsPDF, c: Character): void {
  doc.addPage();
  doc.setLineWidth(LINE);
  let y = MARGIN;
  const st = c.acgState;

  // Header bar
  sectionBar(doc, X0, y, W, 28, "ADVANCED CHARACTER GENERATION — RECORD CARD");
  y += 28;

  // Row 1: Pathway | Rank | Combat Arm / Fleet / Division / Line Type
  const r1H = 36;
  const colW = W / 3;
  doc.rect(X0, y, colW, r1H);
  fieldLabel(doc, X0 + 4, y + 10, "1. Pathway");
  fieldValue(doc, X0 + 6, y + 28, c.acgPathway ?? "—", colW - 8);

  doc.rect(X0 + colW, y, colW, r1H);
  fieldLabel(doc, X0 + colW + 4, y + 10, "2. Rank");
  fieldValue(doc, X0 + colW + 6, y + 28, st?.rankCode ?? "—", colW - 8);

  doc.rect(X0 + 2 * colW, y, colW, r1H);
  // Label depends on pathway: combat arm (merc), fleet (navy), division
  // (scout), line type (merchant prince).
  const subLabel =
    c.acgPathway === "navy" ? "3. Fleet" :
    c.acgPathway === "scout" ? "3. Division" :
    c.acgPathway === "merchantPrince" ? "3. Line Type" :
    "3. Combat Arm";
  const subValue =
    c.acgPathway === "navy" ? (st?.fleet ?? "—") :
    c.acgPathway === "scout" ? (st?.division ?? "—") :
    c.acgPathway === "merchantPrince" ? (st?.lineType ?? "—") :
    (st?.combatArm ?? "—");
  fieldLabel(doc, X0 + 2 * colW + 4, y + 10, subLabel);
  fieldValue(doc, X0 + 2 * colW + 6, y + 28, subValue, colW - 8);
  y += r1H;

  // Row 2: Branch / Office / Department | MOS | Officer status
  const r2H = 36;
  doc.rect(X0, y, colW, r2H);
  const branchLabel =
    c.acgPathway === "navy" ? "4. Branch" :
    c.acgPathway === "scout" ? "4. Office" :
    c.acgPathway === "merchantPrince" ? "4. Department" :
    "4. Branch / Service";
  fieldLabel(doc, X0 + 4, y + 10, branchLabel);
  fieldValue(doc, X0 + 6, y + 28, c.acgBranch ?? "—", colW - 8);

  doc.rect(X0 + colW, y, colW, r2H);
  fieldLabel(doc, X0 + colW + 4, y + 10, "5. MOS / Specialty");
  fieldValue(doc, X0 + colW + 6, y + 28, c.acgMos ?? "—", colW - 8);

  doc.rect(X0 + 2 * colW, y, colW, r2H);
  fieldLabel(doc, X0 + 2 * colW + 4, y + 10, "6. Officer Status");
  fieldValue(doc, X0 + 2 * colW + 6, y + 28,
    st?.isOfficer ? "Commissioned" : "Enlisted", colW - 8);
  y += r2H;

  // Row 3: Brownie Points (current + spent) | Combat Ribbons + Clusters
  const r3H = 60;
  const bpW = 180;
  doc.rect(X0, y, bpW, r3H);
  fieldLabel(doc, X0 + 4, y + 10, "7. Brownie Points");
  doc.setFont("courier", "normal");
  doc.setFontSize(20);
  doc.text(`${c.browniePoints}`, X0 + 10, y + 38);
  doc.setFontSize(8);
  doc.text(`spent: ${st?.browniePointsSpent ?? 0}`, X0 + 60, y + 38);
  doc.setFont(BOLD, "normal");

  doc.rect(X0 + bpW, y, W - bpW, r3H);
  fieldLabel(doc, X0 + bpW + 4, y + 10, "8. Combat Service");
  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  doc.text(`Combat Ribbons: ${st?.combatRibbons ?? 0}`, X0 + bpW + 6, y + 26);
  doc.text(`Command Clusters: ${st?.commandClusters ?? 0}`, X0 + bpW + 6, y + 40);
  doc.text(`Terms served: ${c.terms}`, X0 + bpW + 6, y + 54);
  doc.setFont(BOLD, "normal");
  y += r3H;

  // Row 4: Decorations
  const r4H = 44;
  doc.rect(X0, y, W, r4H);
  fieldLabel(doc, X0 + 4, y + 10, "9. Decorations and Awards");
  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  const decorationsText = c.decorations.length > 0 ? c.decorations.join(", ") : "—";
  const decLines = doc.splitTextToSize(decorationsText, W - 12);
  let dy = y + 26;
  for (const line of decLines.slice(0, 2)) {
    doc.text(line, X0 + 6, dy);
    dy += 12;
  }
  doc.setFont(BOLD, "normal");
  y += r4H;

  // Row 5: Specialist Schools and Training
  const r5H = 90;
  doc.rect(X0, y, W, r5H);
  fieldLabel(doc, X0 + 4, y + 10, "10. Specialist Schools and Training");
  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  const sy = y + 26;
  const schoolLimit = y + r5H - 12;
  if (c.schoolsAttended.length === 0) {
    doc.text("—", X0 + 6, sy);
  } else {
    // Two-column layout for schools.
    const half = W / 2 - 12;
    let col = 0;
    let rowY = sy;
    for (const school of c.schoolsAttended) {
      if (rowY > schoolLimit) break;
      const x = col === 0 ? X0 + 6 : X0 + W / 2 + 6;
      doc.text(`• ${school}`, x, rowY);
      col = (col + 1) % 2;
      if (col === 0) rowY += 12;
      void half;
    }
  }
  doc.setFont(BOLD, "normal");
  y += r5H;

  // Row 6: Assignment History
  const r6H = 90;
  doc.rect(X0, y, W, r6H);
  fieldLabel(doc, X0 + 4, y + 10, "11. Assignment History");
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  const ah = st?.assignmentHistory ?? [];
  if (ah.length === 0) {
    doc.text("—", X0 + 6, y + 26);
  } else {
    // Pack assignments comma-separated, wrapping.
    const txt = ah.join(", ");
    const wrapped = doc.splitTextToSize(txt, W - 12);
    let ahY = y + 26;
    for (const line of wrapped.slice(0, 5)) {
      doc.text(line, X0 + 6, ahY);
      ahY += 11;
    }
  }
  doc.setFont(BOLD, "normal");
  y += r6H;

  // Row 7: Homeworld (also visible on TAS Form 2, repeated here for the
  // ACG record card since the sheet is often printed standalone)
  if (c.homeworld) {
    const r7H = 40;
    doc.rect(X0, y, W, r7H);
    fieldLabel(doc, X0 + 4, y + 10, "12. Homeworld");
    doc.setFont("courier", "normal");
    doc.setFontSize(9);
    const hw = c.homeworld;
    doc.text(
      `Starport ${hw.starport} · ${hw.size} · ${hw.atmosphere} atmosphere · ${hw.hydrosphere}`,
      X0 + 6, y + 24,
    );
    doc.text(
      `${hw.population} · ${hw.law} · Tech ${hw.tech}`,
      X0 + 6, y + 36,
    );
    doc.setFont(BOLD, "normal");
  }
}

/** Footer drawn on every page of the sheet, identifying the edition that
 *  produced the character. Critical for multi-edition repos: an MT sheet
 *  and a CT sheet look broadly similar at the basic level, so the edition
 *  stamp prevents confusion. */
function drawEditionFooter(doc: jsPDF, c: Character): void {
  const meta = getEdition(c.editionId).meta;
  const text = `Generated by Traveller Character Generator · ${meta.displayName} · ${todayLocal()}`;
  const pageCount = doc.getNumberOfPages();
  doc.setFont(BOLD, "italic");
  doc.setFontSize(7);
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.text(text, X0, PAGE_H - MARGIN / 2);
  }
  doc.setFont(BOLD, "normal");
}

export function buildCharacterSheetPdf(c: Character): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  drawTasForm2(doc, c);
  if (c.history.length > 0 || c.benefits.length > 0 || c.credits > 0) {
    drawSupplement(doc, c);
  }
  if (c.useAcg) {
    drawAcgRecordSheet(doc, c);
  }
  drawEditionFooter(doc, c);
  return doc;
}

export function downloadCharacterSheetPdf(c: Character): void {
  try {
    const doc = buildCharacterSheetPdf(c);
    const filename = `${safeFilename(c.name) || "traveller"}-character.pdf`;
    doc.save(filename);
  } catch (err) {
    console.error("Failed to build/save character sheet PDF:", err);
    if (typeof window !== "undefined") {
      window.alert(
        "Could not generate the PDF. See the browser console for details.",
      );
    }
  }
}
