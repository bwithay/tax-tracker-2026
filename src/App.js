import { useState, useEffect, useCallback } from "react";
// Firebase Realtime Database via REST API — no SDK imports needed
const FB_URL = "https://tax-tracker-2026-default-rtdb.firebaseio.com";

async function loadStorage(path) {
  try {
    const res = await fetch(`${FB_URL}/${path}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("Firebase read error:", e);
    return null;
  }
}

async function saveStorage(path, val) {
  try {
    await fetch(`${FB_URL}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(val),
    });
  } catch (e) {
    console.error("Firebase write error:", e);
  }
}

const TAX_CONFIG = {
  standardDeduction: 30000,
  brackets: [
    { min: 0, max: 23200, rate: 0.10 },
    { min: 23200, max: 96000, rate: 0.12 },
    { min: 96000, max: 201050, rate: 0.22 },
    { min: 201050, max: 383900, rate: 0.24 },
  ],
  selfEmploymentRate: 0.153,
  caStateRate: 0.093,
  bracketThreshold: 96000,
  quarterlyDueDates: [
    { quarter: "Q1", due: "April 15, 2026", cutoff: "2026-04-15" },
    { quarter: "Q2", due: "June 16, 2026", cutoff: "2026-06-16" },
    { quarter: "Q3", due: "September 15, 2026", cutoff: "2026-09-15" },
    { quarter: "Q4", due: "January 15, 2027", cutoff: "2027-01-15" },
  ],
};

function calcFederalTax(taxableIncome) {
  let tax = 0;
  for (const b of TAX_CONFIG.brackets) {
    if (taxableIncome <= b.min) break;
    tax += (Math.min(taxableIncome, b.max) - b.min) * b.rate;
  }
  return tax;
}

function getTopBracketRate(taxableIncome) {
  for (let i = TAX_CONFIG.brackets.length - 1; i >= 0; i--) {
    if (taxableIncome > TAX_CONFIG.brackets[i].min) return TAX_CONFIG.brackets[i].rate;
  }
  return TAX_CONFIG.brackets[0].rate;
}

function calcSummary(entries, projections, taxPayments = []) {
  const ytdGross = entries.reduce((s, e) => s + e.amount, 0);
  const ytdNontaxable = entries.filter(e => e.type === "nontaxable").reduce((s, e) => s + e.amount, 0);
  const ytd1099 = entries.filter(e => e.type === "1099").reduce((s, e) => s + e.amount, 0);
  const ytdW2Withheld = entries.filter(e => e.type === "w2").reduce((s, e) => s + (e.withheld || 0), 0);
  const ytdEstPaid = taxPayments.reduce((s, p) => s + p.amount, 0);

  const projTotal = projections.reduce((s, p) => s + p.projectedAnnual, 0);
  const projNontaxable = projections.filter(p => p.type === "nontaxable").reduce((s, p) => s + p.projectedAnnual, 0);
  const projTaxable = projTotal - projNontaxable;
  const proj1099 = projections.filter(p => p.type === "1099").reduce((s, p) => s + p.projectedAnnual, 0);

  // Pre-tax deductions (CalSTRS, health premiums, etc.) reduce taxable income
  const ytdPreTax = entries.reduce((s, e) => s + (e.preTaxDeductions || 0), 0);
  const ytdTaxableW2 = entries.filter(e => e.type === "w2").reduce((s, e) => s + e.amount, 0);
  const preTaxRate = ytdTaxableW2 > 0 ? ytdPreTax / ytdTaxableW2 : 0;
  const projW2 = projections.filter(p => p.type === "w2").reduce((s, p) => s + p.projectedAnnual, 0);
  const annualizedPreTax = preTaxRate > 0 ? projW2 * preTaxRate : ytdPreTax;

  const seTax = proj1099 * TAX_CONFIG.selfEmploymentRate;
  const seDeduction = seTax / 2;
  const taxableIncome = Math.max(0, projTaxable - TAX_CONFIG.standardDeduction - seDeduction - annualizedPreTax);
  const federalTax = calcFederalTax(taxableIncome);
  const caTax = taxableIncome * TAX_CONFIG.caStateRate;
  const totalTax = seTax + federalTax + caTax;
  const effectiveRate = projTotal > 0 ? totalTax / projTotal : 0;
  const topBracket = getTopBracketRate(taxableIncome);

  const ytdTaxPaid = ytdW2Withheld + ytdEstPaid;
  const estimatedOwed = totalTax - ytdTaxPaid;

  const today = new Date();
  const nextQuarter = TAX_CONFIG.quarterlyDueDates.find(q => new Date(q.cutoff) >= today);
  const nextQuarterIndex = TAX_CONFIG.quarterlyDueDates.findIndex(q => new Date(q.cutoff) >= today);
  const remainingQuarters = nextQuarterIndex >= 0 ? TAX_CONFIG.quarterlyDueDates.length - nextQuarterIndex : 1;
  // Correct quarterly payment: remaining tax balance divided by remaining quarters
  // This accounts for W-2 withholding already covering part of the annual bill
  // and any estimated payments already made — no flat-rate guessing
  const quarterlyPayment = remainingQuarters > 0 ? Math.max(0, estimatedOwed) / remainingQuarters : 0;

  // For display: show what portion of total tax is covered by W-2 withholding
  const w2CoverageRate = totalTax > 0 ? ytdW2Withheld / totalTax : 0;

  return {
    ytdGross, projTotal, projTaxable, projNontaxable, proj1099, ytd1099, ytdNontaxable,
    seTax, federalTax, caTax, totalTax,
    effectiveRate, topBracket, taxableIncome,
    ytdTaxPaid, estimatedOwed,
    nextQuarter, nextQuarterIndex, remainingQuarters, quarterlyPayment, w2CoverageRate,
    ytdPreTax, annualizedPreTax,
  };
}



async function parsePaystub(base64, mediaType) {
  const isImage = mediaType.startsWith("image/");
  const contentBlock = isImage
    ? { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };

const res = await fetch("/api/parse-paystub", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",


  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          contentBlock,
          {
            type: "text",
            text: `Extract from this paystub and return ONLY valid JSON, no markdown, no explanation:
{
  "employer": "employer name",
  "payPeriodEnd": "YYYY-MM-DD",
  "grossAmount": number,
  "federalWithheld": number or null,
  "stateWithheld": number or null,
  "preTaxDeductions": number or null,
  "payType": "w2" or "1099",
  "notes": "brief notes"
}
For preTaxDeductions: sum all pre-tax deductions that reduce taxable income such as retirement contributions (CalSTRS, 403b, 401k), pre-tax health/dental/vision premiums, FSA/HSA contributions. Do NOT include post-tax deductions. Use null if none found.
Use null for unknown fields.`
          }
        ]
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

const fmt = (n) => n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtPct = (n) => (n * 100).toFixed(1) + "%";

const INIT_PROJECTIONS = [
  { id: 1, label: "SDCCE", type: "w2", projectedAnnual: 85000 },
  { id: 2, label: "Career Certified", type: "1099", projectedAnnual: 10000 },
  { id: 3, label: "Stanford Health Care", type: "1099", projectedAnnual: 28600 },
  { id: 4, label: "IHSS", type: "nontaxable", projectedAnnual: 9600 },
];

export default function App() {
  const [entries, setEntries] = useState([]);
  const [projections, setProjections] = useState(INIT_PROJECTIONS);
  const [tab, setTab] = useState("dashboard");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [editId, setEditId] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ employer: "", amount: "", type: "1099", withheld: "", preTaxDeductions: "", estimatedPayment: "", date: new Date().toISOString().slice(0,10), notes: "" });
  const [taxPayments, setTaxPayments] = useState([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", agency: "IRS", date: new Date().toISOString().slice(0,10) });

  useEffect(() => {
    (async () => {
      const e = await loadStorage("bryan/tax2026/entries");
      const p = await loadStorage("bryan/tax2026/projections");
      const t = await loadStorage("bryan/tax2026/payments");
      // Firebase stores arrays as objects with numeric keys — convert back to arrays
      if (e) setEntries(Array.isArray(e) ? e : Object.values(e));
      if (p) setProjections(Array.isArray(p) ? p : Object.values(p));
      if (t) setTaxPayments(Array.isArray(t) ? t : Object.values(t));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveStorage("bryan/tax2026/entries", entries); }, [entries, loaded]);
  useEffect(() => { if (loaded) saveStorage("bryan/tax2026/projections", projections); }, [projections, loaded]);
  useEffect(() => { if (loaded) saveStorage("bryan/tax2026/payments", taxPayments); }, [taxPayments, loaded]);

  const enrichedProjections = projections.map(p => {
    const received = entries
      .filter(e => e.employer?.toLowerCase().includes(p.label.toLowerCase()) || p.label.toLowerCase().includes((e.employer || "").toLowerCase().split(" ")[0]))
      .reduce((s, e) => s + e.amount, 0);
    return { ...p, receivedSoFar: received };
  });

  const summary = calcSummary(entries, enrichedProjections, taxPayments);

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg("Reading file...");
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      setUploadMsg("AI is reading your paystub...");
      const parsed = await parsePaystub(b64, file.type || "application/pdf");
      const entry = {
        id: Date.now(),
        employer: parsed.employer || "Unknown",
        amount: parsed.grossAmount || 0,
        type: parsed.payType || "w2",
        withheld: (parsed.federalWithheld || 0) + (parsed.stateWithheld || 0),
        preTaxDeductions: parsed.preTaxDeductions || 0,
        estimatedPayment: 0,
        date: parsed.payPeriodEnd || new Date().toISOString().slice(0,10),
        notes: parsed.notes || "",
        source: "ai",
      };
      setEntries(prev => [entry, ...prev]);
      setUploadMsg(`Added: ${entry.employer} ${fmt(entry.amount)}`);
      setTab("income");
    } catch {
      setUploadMsg("Could not parse. Please add manually.");
    }
    setUploading(false);
    setTimeout(() => setUploadMsg(""), 5000);
    e.target.value = "";
  }, []);

  const saveManual = () => {
    setEntries(prev => [{
      id: Date.now(),
      employer: form.employer || "Unknown",
      amount: parseFloat(form.amount) || 0,
      type: form.type,
      withheld: parseFloat(form.withheld) || 0,
      preTaxDeductions: parseFloat(form.preTaxDeductions) || 0,
      estimatedPayment: parseFloat(form.estimatedPayment) || 0,
      date: form.date,
      notes: form.notes,
      source: "manual",
    }, ...prev]);
    setForm({ employer: "", amount: "", type: "1099", withheld: "", preTaxDeductions: "", estimatedPayment: "", date: new Date().toISOString().slice(0,10), notes: "" });
    setShowManual(false);
  };

  const savePayment = () => {
    setTaxPayments(prev => [{
      id: Date.now(),
      amount: parseFloat(paymentForm.amount) || 0,
      agency: paymentForm.agency,
      date: paymentForm.date,
    }, ...prev]);
    setPaymentForm({ amount: "", agency: "IRS", date: new Date().toISOString().slice(0,10) });
    setShowPaymentForm(false);
  };

  const c = {
    bg: "#f4f3ef",
    surface: "#ffffff",
    border: "rgba(0,0,0,0.08)",
    gold: "#b8860b",
    green: "#1a7a4a",
    red: "#c0392b",
    text: "#1a1a1a",
    muted: "#7a7a7a",
    dim: "#e0ddd8",
  };

  const card = (extra = {}) => ({
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 14,
    padding: "18px 20px",
    ...extra,
  });

  const inp = {
    background: "#f8f7f4",
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    color: c.text,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
  };

  const btn = (variant = "ghost") => ({
    padding: "9px 16px",
    borderRadius: 9,
    border: "none",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: variant === "gold" ? c.gold : variant === "danger" ? "rgba(192,57,43,0.08)" : "rgba(0,0,0,0.06)",
    color: variant === "gold" ? "#000" : variant === "danger" ? c.red : "#444",
  });

  const bracketPct = Math.min(100, (summary.taxableIncome / TAX_CONFIG.bracketThreshold) * 100);
  const isOver = summary.taxableIncome >= TAX_CONFIG.bracketThreshold;

  return (
    <div style={{ minHeight: "100vh", background: c.bg, color: c.text, fontFamily: "'DM Sans', sans-serif", paddingBottom: 60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select { font-family: inherit; }
        input:focus, select:focus { border-color: rgba(184,134,11,0.5) !important; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #c8c4bc; border-radius: 99px; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "28px 20px 0", borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: c.text }}>Tax Tracker 2026</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>Bryan · MFJ · California</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: c.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Projected Annual</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono'", color: c.gold }}>{fmt(summary.projTotal)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, marginTop: 16 }}>
          {["dashboard", "income", "payments", "projections", "export"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "none", border: "none",
              color: tab === t ? c.gold : c.muted,
              borderBottom: `2px solid ${tab === t ? c.gold : "transparent"}`,
              marginBottom: -1, letterSpacing: "0.01em",
            }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 16px" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Top row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ ...card(), background: `linear-gradient(135deg, ${c.gold}18, ${c.gold}06)`, borderColor: `${c.gold}40` }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.gold, fontWeight: 600, marginBottom: 6 }}>Est. Tax Owed</div>
                <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono'", color: summary.estimatedOwed > 0 ? c.red : c.green }}>
                  {fmt(Math.abs(summary.estimatedOwed))}
                </div>
                <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>
                  {summary.estimatedOwed > 0 ? "still owed" : "overpaid"} · {fmt(summary.ytdTaxPaid)} paid so far
                </div>
              </div>
              <div style={{ ...card(), background: `linear-gradient(135deg, #1a7a4a18, #1a7a4a06)`, borderColor: `#1a7a4a30` }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.green, fontWeight: 600, marginBottom: 6 }}>Next Quarterly</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono'", color: c.text }}>{summary.nextQuarter?.quarter || "—"}</div>
                <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>{summary.nextQuarter?.due}</div>
              </div>
            </div>

            {/* Quarterly suggestion */}
            <div style={{ ...card(), display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.muted, fontWeight: 600, marginBottom: 4 }}>Suggested Quarterly Payment</div>
                <div style={{ fontSize: 11, color: c.muted }}>Remaining est. tax ÷ {summary.remainingQuarters} remaining quarter{summary.remainingQuarters !== 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>W-2 withholding covers ~{Math.round(summary.w2CoverageRate * 100)}% of total bill</div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'DM Mono'", color: c.gold }}>{fmt(summary.quarterlyPayment)}</div>
            </div>

            {/* Bracket meter */}
            <div style={card()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.muted, fontWeight: 600 }}>Current Top Bracket</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: isOver ? c.red : c.green }}>
                  {isOver ? "22% on income above threshold" : "12% — within lower bracket"}
                </div>
              </div>
              <div style={{ height: 6, background: c.dim, borderRadius: 99, overflow: "hidden", marginBottom: 8 }}>
                <div style={{
                  width: `${bracketPct}%`, height: "100%", borderRadius: 99,
                  background: isOver ? `linear-gradient(90deg, ${c.green}, ${c.red})` : `linear-gradient(90deg, ${c.green}, ${c.gold})`,
                  transition: "width 0.8s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: c.muted }}>Taxable: {fmt(summary.taxableIncome)}</span>
                <span style={{ fontSize: 11, color: c.muted }}>
                  {isOver ? `${fmt(summary.taxableIncome - TAX_CONFIG.bracketThreshold)} above threshold — only this amount taxed at 22%` : `${fmt(TAX_CONFIG.bracketThreshold - summary.taxableIncome)} of room before 22% applies`}
                </span>
              </div>
            </div>

            {/* Tax breakdown */}
            <div style={card()}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.muted, fontWeight: 600, marginBottom: 14 }}>Tax Breakdown</div>
              {[
                { label: "Self-Employment (15.3%)", val: summary.seTax, color: c.gold },
                { label: "Federal Income", val: summary.federalTax, color: c.text },
                { label: "CA State (~9.3%)", val: summary.caTax, color: c.text },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${c.border}` }}>
                  <span style={{ fontSize: 13, color: c.muted }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'DM Mono'", color: row.color }}>{fmt(row.val)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Total · {fmtPct(summary.effectiveRate)} effective</span>
                <span style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono'", color: c.gold }}>{fmt(summary.totalTax)}</span>
              </div>
            </div>

            {/* Assumptions */}
            <div style={{ ...card(), background: "transparent", borderColor: c.dim }}>
              <div style={{ fontSize: 11, color: c.muted }}>
                Standard deduction {fmt(TAX_CONFIG.standardDeduction)} · SE deduction {fmt(summary.seTax / 2)} · Pre-tax deductions {fmt(summary.annualizedPreTax)} · Taxable income {fmt(summary.taxableIncome)} · IHSS {fmt(summary.projNontaxable)} excluded · MFJ 2026 est.
              </div>
            </div>
          </div>
        )}

        {/* INCOME */}
        {tab === "income" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              <label style={{ ...btn("gold"), display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                {uploading ? "Parsing..." : "Upload Paystub (AI)"}
                <input type="file" accept=".pdf,image/*" onChange={handleUpload} style={{ display: "none" }} disabled={uploading} />
              </label>
              <button style={btn()} onClick={() => setShowManual(v => !v)}>+ Manual Entry</button>
            </div>

            {uploadMsg && (
              <div style={{ fontSize: 13, color: c.gold, padding: "10px 14px", background: `${c.gold}18`, borderRadius: 8, marginBottom: 12 }}>
                {uploadMsg}
              </div>
            )}

            {showManual && (
              <div style={{ ...card(), marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 14 }}>Add Income Entry</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Source / Employer", key: "employer", placeholder: "SDCCE, Stanford..." },
                    { label: "Gross Amount ($)", key: "amount", placeholder: "0", type: "number" },
                    { label: "Pay Date", key: "date", type: "date" },
                  ].map(f => (
                    <div key={f.key} style={f.key === "employer" ? { gridColumn: "1 / -1" } : {}}>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>{f.label}</div>
                      <input style={inp} type={f.type || "text"} placeholder={f.placeholder} value={form[f.key]}
                        onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
                    </div>
                  ))}
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Type</div>
                    <select style={inp} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                      <option value="w2">W-2</option>
                      <option value="1099">1099</option>
                      <option value="nontaxable">Non-taxable (IHSS)</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>
                      {form.type === "w2" ? "Tax Withheld ($)" : "Est. Payment Made ($)"}
                    </div>
                    <input style={inp} type="number" placeholder="0"
                      value={form.type === "w2" ? form.withheld : form.estimatedPayment}
                      onChange={e => setForm(p => form.type === "w2" ? { ...p, withheld: e.target.value } : { ...p, estimatedPayment: e.target.value })} />
                  </div>
                  {form.type === "w2" && (
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Pre-Tax Deductions ($)</div>
                      <div style={{ fontSize: 10, color: c.muted, marginBottom: 4 }}>CalSTRS, health premiums, etc.</div>
                      <input style={inp} type="number" placeholder="0" value={form.preTaxDeductions}
                        onChange={e => setForm(p => ({ ...p, preTaxDeductions: e.target.value }))} />
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1", fontSize: 11, color: c.muted, padding: "4px 0" }}>
                    To log an IRS or CA FTB estimated tax payment, use the <strong>Payments</strong> tab.
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Notes</div>
                    <input style={inp} placeholder="Optional" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button style={btn("gold")} onClick={saveManual}>Save</button>
                  <button style={btn()} onClick={() => setShowManual(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.muted, fontWeight: 600, marginBottom: 10 }}>
              Entries ({entries.length}) · YTD {fmt(entries.reduce((s,e) => s+e.amount,0))}
            </div>

            {entries.length === 0 && (
              <div style={{ textAlign: "center", color: c.muted, padding: "40px 0", fontSize: 13 }}>
                No entries yet. Upload a paystub or add manually.
              </div>
            )}

            {entries.map(e => (
              <div key={e.id} style={{ ...card(), display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{e.employer}</span>
                    <span style={{
                      fontSize: 9, padding: "2px 7px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.1em",
                      background: e.type === "1099" ? `${c.gold}20` : e.type === "nontaxable" ? "rgba(80,80,204,0.12)" : `${c.green}18`,
                      color: e.type === "1099" ? c.gold : e.type === "nontaxable" ? "#a0a0ff" : c.green,
                    }}>{e.type === "nontaxable" ? "NON-TAX" : e.type.toUpperCase()}</span>
                    {e.source === "ai" && <span style={{ fontSize: 9, color: c.muted }}>AI parsed</span>}
                  </div>
                  <div style={{ fontSize: 11, color: c.muted }}>{e.date}{e.notes ? ` · ${e.notes}` : ""}</div>
                  {e.withheld > 0 && <div style={{ fontSize: 11, color: c.green, marginTop: 2 }}>Withheld {fmt(e.withheld)}</div>}
                  {e.preTaxDeductions > 0 && <div style={{ fontSize: 11, color: "#5050cc", marginTop: 2 }}>Pre-tax deductions {fmt(e.preTaxDeductions)}</div>}
                  {e.estimatedPayment > 0 && <div style={{ fontSize: 11, color: c.gold, marginTop: 2 }}>Est. paid {fmt(e.estimatedPayment)}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'DM Mono'", color: "#fff" }}>{fmt(e.amount)}</div>
                  <button style={{ ...btn("danger"), padding: "3px 10px", fontSize: 11, marginTop: 6 }} onClick={() => setEntries(p => p.filter(x => x.id !== e.id))}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAX PAYMENTS */}
        {tab === "payments" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button style={btn("gold")} onClick={() => setShowPaymentForm(v => !v)}>+ Log Payment</button>
            </div>

            {showPaymentForm && (
              <div style={{ ...card(), marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 14 }}>Log Estimated Tax Payment</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Amount ($)</div>
                    <input style={inp} type="number" placeholder="0" value={paymentForm.amount}
                      onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Agency</div>
                    <select style={inp} value={paymentForm.agency} onChange={e => setPaymentForm(p => ({ ...p, agency: e.target.value }))}>
                      <option value="IRS">IRS (Federal)</option>
                      <option value="CA FTB">CA FTB (State)</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Date Paid</div>
                    <input style={inp} type="date" value={paymentForm.date}
                      onChange={e => setPaymentForm(p => ({ ...p, date: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button style={btn("gold")} onClick={savePayment}>Save</button>
                  <button style={btn()} onClick={() => setShowPaymentForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: c.muted, fontWeight: 600, marginBottom: 10 }}>
              Payments ({taxPayments.length}) · Total {fmt(taxPayments.reduce((s, p) => s + p.amount, 0))}
            </div>

            {taxPayments.length === 0 && (
              <div style={{ textAlign: "center", color: c.muted, padding: "40px 0", fontSize: 13 }}>
                No payments logged yet.
              </div>
            )}

            {taxPayments.map(p => (
              <div key={p.id} style={{ ...card(), display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.agency}</span>
                    <span style={{
                      fontSize: 9, padding: "2px 7px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.1em",
                      background: p.agency === "IRS" ? "rgba(184,134,11,0.12)" : "rgba(26,122,74,0.1)",
                      color: p.agency === "IRS" ? c.gold : c.green,
                    }}>ESTIMATED</span>
                  </div>
                  <div style={{ fontSize: 11, color: c.muted }}>{p.date}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'DM Mono'", color: c.text }}>{fmt(p.amount)}</div>
                  <button style={{ ...btn("danger"), padding: "3px 10px", fontSize: 11, marginTop: 6 }}
                    onClick={() => setTaxPayments(prev => prev.filter(x => x.id !== p.id))}>Remove</button>
                </div>
              </div>
            ))}

            <div style={{ ...card(), marginTop: 16, background: "transparent", borderColor: c.dim }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 8 }}>Payment Summary</div>
              {["IRS", "CA FTB"].map(agency => {
                const total = taxPayments.filter(p => p.agency === agency).reduce((s, p) => s + p.amount, 0);
                return (
                  <div key={agency} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${c.border}` }}>
                    <span style={{ fontSize: 12, color: c.muted }}>{agency}</span>
                    <span style={{ fontSize: 12, fontFamily: "'DM Mono'", color: c.text }}>{fmt(total)}</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: c.text }}>Total paid</span>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono'", color: c.green }}>{fmt(taxPayments.reduce((s, p) => s + p.amount, 0))}</span>
              </div>
            </div>
          </div>
        )}

        {/* PROJECTIONS */}
        {tab === "projections" && (
          <div>
            <div style={{ fontSize: 12, color: c.muted, marginBottom: 16 }}>
              These annual projections drive all tax estimates. Update them as contracts change or new income sources appear.
            </div>

            {enrichedProjections.map(p => (
              <div key={p.id} style={{ ...card(), marginBottom: 10 }}>
                {editId === p.id ? (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div style={{ gridColumn: "1/-1" }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Label</div>
                        <input style={inp} value={p.label} onChange={e => setProjections(prev => prev.map(x => x.id === p.id ? { ...x, label: e.target.value } : x))} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Type</div>
                        <select style={inp} value={p.type} onChange={e => setProjections(prev => prev.map(x => x.id === p.id ? { ...x, type: e.target.value } : x))}>
                          <option value="w2">W-2</option>
                          <option value="1099">1099</option>
                          <option value="nontaxable">Non-taxable (IHSS)</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: c.muted, marginBottom: 4 }}>Projected Annual ($)</div>
                        <input style={inp} type="number" value={p.projectedAnnual}
                          onChange={e => setProjections(prev => prev.map(x => x.id === p.id ? { ...x, projectedAnnual: parseFloat(e.target.value) || 0 } : x))} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button style={btn("gold")} onClick={() => setEditId(null)}>Done</button>
                      <button style={btn("danger")} onClick={() => { setProjections(prev => prev.filter(x => x.id !== p.id)); setEditId(null); }}>Delete</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</span>
                        <span style={{
                          fontSize: 9, padding: "2px 7px", borderRadius: 99, fontWeight: 700, letterSpacing: "0.1em",
                          background: p.type === "1099" ? `${c.gold}20` : p.type === "nontaxable" ? "rgba(80,80,204,0.12)" : `${c.green}18`,
                          color: p.type === "1099" ? c.gold : p.type === "nontaxable" ? "#a0a0ff" : c.green,
                        }}>{p.type === "nontaxable" ? "NON-TAX" : p.type.toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize: 12, color: c.green }}>{fmt(p.receivedSoFar)} received</div>
                      <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>
                        {fmt(Math.max(0, p.projectedAnnual - p.receivedSoFar))} remaining · {p.projectedAnnual > 0 ? Math.round((p.receivedSoFar / p.projectedAnnual) * 100) : 0}% of year done
                      </div>
                      {/* mini progress */}
                      <div style={{ marginTop: 8, height: 3, width: 120, background: c.dim, borderRadius: 99 }}>
                        <div style={{ height: "100%", borderRadius: 99, background: c.green, width: `${Math.min(100, p.projectedAnnual > 0 ? (p.receivedSoFar / p.projectedAnnual) * 100 : 0)}%` }} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono'" }}>{fmt(p.projectedAnnual)}</div>
                      <div style={{ fontSize: 10, color: c.muted, marginBottom: 8 }}>projected annual</div>
                      <button style={{ ...btn(), padding: "4px 12px", fontSize: 11 }} onClick={() => setEditId(p.id)}>Edit</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <button style={{ ...btn(), width: "100%", textAlign: "center", marginTop: 4 }}
              onClick={() => setProjections(prev => [...prev, { id: Date.now(), label: "New Source", type: "1099", projectedAnnual: 0 }])}>
              + Add Income Source
            </button>

            <div style={{ ...card(), marginTop: 16, background: "transparent", borderColor: c.dim }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 8 }}>Projection Summary</div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${c.border}` }}>
                <span style={{ fontSize: 12, color: c.muted }}>Total projected gross</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono'", color: c.text }}>{fmt(summary.projTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${c.border}` }}>
                <span style={{ fontSize: 12, color: c.muted }}>1099 income</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono'", color: c.gold }}>{fmt(summary.proj1099)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${c.border}` }}>
                <span style={{ fontSize: 12, color: c.muted }}>Non-taxable (IHSS)</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono'", color: "#5050cc" }}>{fmt(summary.projNontaxable)} <span style={{fontSize:10, color: c.muted}}>excluded</span></span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ fontSize: 12, color: c.muted }}>Estimated taxable income</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono'", color: c.text }}>{fmt(summary.taxableIncome)}</span>
              </div>
            </div>
          </div>
        )}

        {/* EXPORT */}
        {tab === "export" && (() => {
          const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
          
          const w2Entries = entries.filter(e => e.type === "w2");
         

          const lines = [
            "=".repeat(52),
            "  TAX SUMMARY REPORT — 2026",
            `  Generated: ${today}`,
            "  Filing Status: Married Filing Jointly | CA",
            "=".repeat(52),
            "",
            "── INCOME PROJECTIONS ──────────────────────────────",
            ...enrichedProjections.map(p =>
              `  ${p.label.padEnd(24)} ${fmt(p.projectedAnnual).padStart(10)}  [${p.type === "nontaxable" ? "NON-TAX" : p.type.toUpperCase()}]  received: ${fmt(p.receivedSoFar)}`
            ),
            "",
            `  Total Projected Gross:         ${fmt(summary.projTotal).padStart(10)}`,
            `  Total Projected Taxable:       ${fmt(summary.projTaxable).padStart(10)}`,
            `  Non-Taxable (IHSS excluded):   ${fmt(summary.projNontaxable).padStart(10)}`,
            "",
            "── TAX CALCULATIONS ────────────────────────────────",
            `  Standard Deduction (MFJ est):  ${fmt(TAX_CONFIG.standardDeduction).padStart(10)}`,
            `  SE Tax Deduction:              ${fmt(summary.seTax / 2).padStart(10)}`,
            `  Pre-Tax Deductions (annlzd):   ${fmt(summary.annualizedPreTax).padStart(10)}`,
            `  YTD Pre-Tax Deductions:        ${fmt(summary.ytdPreTax).padStart(10)}`,

            `  Estimated Taxable Income:      ${fmt(summary.taxableIncome).padStart(10)}`,
            `  Top Marginal Bracket:          ${fmtPct(summary.topBracket).padStart(10)}`,
            "",
            `  Self-Employment Tax (15.3%):   ${fmt(summary.seTax).padStart(10)}`,
            `  Federal Income Tax:            ${fmt(summary.federalTax).padStart(10)}`,
            `  CA State Tax (~9.3%):          ${fmt(summary.caTax).padStart(10)}`,
            `  ─────────────────────────────────────────────`,
            `  Total Estimated Tax:           ${fmt(summary.totalTax).padStart(10)}`,
            `  Effective Rate:                ${fmtPct(summary.effectiveRate).padStart(10)}`,
            "",
            "── PAYMENTS MADE ───────────────────────────────────",
            `  W-2 Tax Withheld YTD:          ${fmt(w2Entries.reduce((s,e) => s+(e.withheld||0),0)).padStart(10)}`,
            `  Estimated Payments Made:       ${fmt(entries.reduce((s,e) => s+(e.estimatedPayment||0),0)).padStart(10)}`,
            `  Total Paid/Withheld:           ${fmt(summary.ytdTaxPaid).padStart(10)}`,
            `  ─────────────────────────────────────────────`,
            `  Estimated Balance Due:         ${fmt(Math.max(0,summary.estimatedOwed)).padStart(10)}`,
            "",
            summary.nextQuarter ? `  Next Quarterly Payment Due: ${summary.nextQuarter.quarter} — ${summary.nextQuarter.due}` : "",
            `  Suggested Quarterly Payment:   ${fmt(summary.quarterlyPayment).padStart(10)}  (remaining tax / ${summary.remainingQuarters} qtrs left)`,
            `  W-2 Withholding Coverage:     ${Math.round(summary.w2CoverageRate * 100)}% of total tax bill`,
            "",
            "── TAX PAYMENTS ────────────────────────────────────",
            taxPayments.length === 0 ? "  No payments logged yet." : "",
            ...taxPayments.map(p => `  ${p.date}  ${p.agency.padEnd(8)}  ${fmt(p.amount).padStart(10)}`),
            taxPayments.length > 0 ? `  ${"─".repeat(40)}` : "",
            taxPayments.length > 0 ? `  Total paid:               ${fmt(taxPayments.reduce((s,p) => s+p.amount,0)).padStart(10)}` : "",
            "",
            "── PAYSTUB ENTRIES ─────────────────────────────────",
            entries.length === 0 ? "  No entries logged yet." : "",
            ...entries.map((e, i) => [
              `  ${String(i+1).padStart(2)}. ${e.employer}`,
              `      Date: ${e.date}  |  Type: ${e.type.toUpperCase()}  |  Gross: ${fmt(e.amount)}`,
              e.withheld > 0 ? `      Withheld: ${fmt(e.withheld)}` : "",
              e.estimatedPayment > 0 ? `      Est. Payment: ${fmt(e.estimatedPayment)}` : "",
              e.notes ? `      Notes: ${e.notes}` : "",
              "",
            ].filter(Boolean)).flat(),
            "=".repeat(52),
            "  NOTE: These are estimates only. Consult a tax",
            "  professional for your final return.",
            "=".repeat(52),
          ].filter(l => l !== undefined);

          const reportText = lines.join("\n");

          const handleCopy = () => {
            navigator.clipboard.writeText(reportText).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 3000);
            });
          };

          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: c.text }}>Tax Summary Report</div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>Copy and paste into any conversation</div>
                </div>
                <button style={btn(copied ? "gold" : "ghost")} onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy All"}
                </button>
              </div>
              <pre style={{
                background: "#f8f7f3",
                border: `1px solid ${c.border}`,
                borderRadius: 12,
                padding: "16px",
                fontSize: 11,
                fontFamily: "'DM Mono', monospace",
                color: "#2a2a2a",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.7,
                overflowX: "auto",
              }}>
                {reportText}
              </pre>
            </div>
          );
        })()}

      </div>
    </div>
  );
}