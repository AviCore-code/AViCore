import { useEffect, useMemo, useRef, useState } from "react";
import {
  importPdf,
  saveExperience,
  loadExperience,
  listExperience,
  deleteExperience,
  saveImage
} from "../../services/desktopDatabase.js";
import useOnlineOnly from "../../hooks/useOnlineOnly.js";
import OnlineOnlyNotice from "../../components/OnlineOnlyNotice.jsx";
import { sumHours, normalizeAircraftRow } from "../../utils/timeMath.js";
import usePrintFit from "../../hooks/usePrintFit.js";
import "./PilotExperienceBuilder.css";

const POSITIONS = ["Captain", "SFO", "FO"];

const blank = {
  code: "",
  name: "",
  licence: "",
  hbd: "",
  position: POSITIONS[0],
  update: "",
  logo: "",
  photo: "",
  specialty: [
    ["IFR(IMC)", ""],
    ["Night", ""],
    ["Offshore", ""],
    ["TRI", ""],
    ["TRE", ""]
  ],
  sim: [],
  rotarySingle: [],
  fixedSingle: [],
  rotaryMulti: [],
  fixedMulti: []
};

export default function PilotExperienceBuilder() {
  const online = useOnlineOnly();
  const [data, setData] = useState(blank);
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);

  const printRef = useRef(null);
  // A4 landscape, 8mm margin - matches the @page rule in PilotExperienceBuilder.css.
  const printFitVars = usePrintFit(printRef, { widthMm: 297, heightMm: 210, marginMm: 8 }, [data]);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const totals = useMemo(() => {
    const heli = [...data.rotarySingle, ...data.rotaryMulti];
    const fixed = [...data.fixedSingle, ...data.fixedMulti];
    const all = [...heli, ...fixed];

    return {
      pic: sumHours(all.map((r) => r[1])),
      picus: sumHours(all.map((r) => r[2])),
      sic: sumHours(all.map((r) => r[3])),
      helicopter: sumHours(heli.map((r) => r[4])),
      fixed: sumHours(fixed.map((r) => r[4])),
      grand: sumHours(all.map((r) => r[4]))
    };
  }, [data]);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setSaved(await listExperience());
  }

  function update(key, value) {
    setData({ ...data, [key]: value });
  }

  // Resize/compress client-side before storing - fully automatic, no button
  // to press. This record's logo/photo travel inside record_json to every
  // device via Central Sync (logoPath/photoPath are local disk paths on this
  // machine only, meaningless on another device - the base64 here is the
  // part that actually syncs). An unresized phone-camera photo can be
  // several MB, which used to make the sync push to Supabase fail outright
  // once record_json grew past the request size the server would accept -
  // "Save" would still succeed (that's only a local SQLite write) but every
  // sync afterwards would keep failing on that same oversized row.
  //
  // Shared by both a freshly-picked file (setImage, below) and a record
  // that's just been reopened (handleLoad, further down) - reopening any
  // pilot whose photo/logo was saved before this auto-shrink existed fixes
  // it automatically too, no "Remove and re-upload" needed. Already-small
  // images are left untouched (width <= the target already) so this never
  // needlessly re-compresses a fine image every time a record is opened.
  function shrinkDataUrl(dataUrl, key) {
    return new Promise((resolve) => {
      if (!dataUrl) { resolve(dataUrl); return; }
      const maxW = key === "logo" ? 300 : 480;
      const img = new Image();
      img.onload = () => {
        if (img.width <= maxW) { resolve(dataUrl); return; }
        const scale = maxW / img.width;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(key === "logo" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => resolve(dataUrl); // corrupt/unreadable - leave as-is rather than losing it
      img.src = dataUrl;
    });
  }

  function setImage(key, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const shrunk = await shrinkDataUrl(reader.result, key);
      setData((prev) => ({ ...prev, [key]: shrunk }));
    };
    reader.readAsDataURL(file);
  }

  // Clears the image from the form only - like every other field here, it
  // isn't persisted until "Save Experience" is clicked. Lets a record that's
  // already too large to sync (from before the resize above existed) be
  // fixed by removing the oversized photo/logo and saving again.
  function removeImage(key) {
    setData((prev) => ({ ...prev, [key]: "" }));
  }

  function updateSpecialty(index, value) {
    const next = structuredClone(data);
    next.specialty[index][1] = value;
    setData(next);
  }

  function addSimulator() {
    setData({ ...data, sim: [...data.sim, ["", ""]] });
  }

  function updateSimulator(index, column, value) {
    const next = structuredClone(data);
    next.sim[index][column] = value;
    setData(next);
  }

  function deleteSimulator(index) {
    const next = structuredClone(data);
    next.sim.splice(index, 1);
    setData(next);
  }

  function addAircraft(group) {
    setData({
      ...data,
      [group]: [...data[group], ["", "0:00", "0:00", "0:00", "0:00"]]
    });
  }

  function updateAircraft(group, index, column, value) {
    const next = structuredClone(data);
    next[group][index][column] = value;

    if (column >= 1 && column <= 3) {
      next[group][index][4] = sumHours([
        next[group][index][1],
        next[group][index][2],
        next[group][index][3]
      ]);
    }

    setData(next);
  }

  function deleteAircraft(group, index) {
    const next = structuredClone(data);
    next[group].splice(index, 1);
    setData(next);
  }

  async function handleImportPdf() {
    setLoading(true);
    try {
      const parsed = await importPdf();
      if (!parsed) return;

      setData((prev) => ({
        ...prev,
        code: parsed.code || "",
        name: parsed.name || "",
        licence: parsed.licence || "",
        update: parsed.update || "",
        specialty: parsed.specialty || blank.specialty,
        sim: parsed.sim || [],
        rotarySingle: (parsed.rotarySingle || []).map(normalizeAircraftRow),
        fixedSingle: (parsed.fixedSingle || []).map(normalizeAircraftRow),
        rotaryMulti: (parsed.rotaryMulti || []).map(normalizeAircraftRow),
        fixedMulti: (parsed.fixedMulti || []).map(normalizeAircraftRow)
      }));

      alert("PDF loaded. Please review the data before saving.");
    } catch (err) {
      alert("PDF load failed: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!data.licence) {
      alert("Enter a Licence number or load a PDF first.");
      return;
    }

    // Never let an empty form overwrite a record that has data in it.
    //
    // This is not hypothetical. While the web build's loader was broken, the
    // Builder opened blank for every pilot - and a blank form saved on top of
    // a real record wipes it. The save path has no way to tell "the pilot
    // genuinely flies nothing" from "the page failed to load", so it asks.
    const tablesEmpty = ["rotarySingle", "fixedSingle", "rotaryMulti", "fixedMulti"]
      .every((g) => !(data[g] || []).some((r) => (r[0] || "").trim()));
    if (tablesEmpty) {
      const existing = await loadExperience(data.licence).catch(() => null);
      const hadData = ["rotarySingle", "fixedSingle", "rotaryMulti", "fixedMulti"]
        .some((g) => (existing?.experienceBase?.[g] || []).length);
      if (hadData && !confirm(
        "This form has NO aircraft rows, but the saved record HAS them.\n\n" +
        "Saving now will erase every aircraft type and all the hours on file for this pilot.\n\n" +
        "If the page opened blank, press Cancel and reload instead.\n\nOverwrite anyway?"
      )) return;
    }

    try {
      const safeId = data.licence.replaceAll(".", "_");
      const logoPath = data.logo ? await saveImage(data.logo, "Logos", `${safeId}_logo.png`) : "";
      const photoPath = data.photo ? await saveImage(data.photo, "Photos", `${safeId}_photo.jpg`) : "";

      await saveExperience({
        profile: {
          code: data.code,
          name: data.name,
          licence: data.licence,
          hbd: data.hbd,
          position: data.position,
          update: data.update,
          logo: data.logo,
          photo: data.photo,
          logoPath,
          photoPath
        },
        experienceBase: {
          specialty: data.specialty,
          simulator: data.sim,
          rotarySingle: data.rotarySingle,
          fixedSingle: data.fixedSingle,
          rotaryMulti: data.rotaryMulti,
          fixedMulti: data.fixedMulti,
          totals
        },
        modifiedAt: new Date().toISOString()
      });

      // Confirm success right away so a later failure in refresh() (e.g. the
      // list query) can never swallow the "it worked" message - previously
      // this whole function had no try/catch at all, so ANY error anywhere
      // in the save pipeline (image write, DB write, or the refresh below)
      // would fail completely silently and the user would see nothing.
      alert("Saved.");
      await refresh();
    } catch (err) {
      alert("Save failed: " + err.message);
    }
  }

  async function handleLoad(query) {
    const record = await loadExperience(query);
    if (!record) {
      alert("No record found.");
      return;
    }

    // Auto-shrink on the way in too - a pilot saved before this feature
    // existed may still have a full-size photo/logo sitting in record_json;
    // reopening it here shrinks it automatically, so all it takes to fix an
    // old sync-failing record is opening it and clicking Save again.
    const [logo, photo] = await Promise.all([
      shrinkDataUrl(record.profile?.logo || "", "logo"),
      shrinkDataUrl(record.profile?.photo || "", "photo")
    ]);

    setData({
      code: record.profile?.code || "",
      name: record.profile?.name || "",
      licence: record.profile?.licence || "",
      hbd: record.profile?.hbd || "",
      position: record.profile?.position || POSITIONS[0],
      update: record.profile?.update || "",
      logo,
      photo,
      specialty: record.experienceBase?.specialty || blank.specialty,
      sim: record.experienceBase?.simulator || [],
      rotarySingle: (record.experienceBase?.rotarySingle || []).map(normalizeAircraftRow),
      fixedSingle: (record.experienceBase?.fixedSingle || []).map(normalizeAircraftRow),
      rotaryMulti: (record.experienceBase?.rotaryMulti || []).map(normalizeAircraftRow),
      fixedMulti: (record.experienceBase?.fixedMulti || []).map(normalizeAircraftRow)
    });
  }

  async function handleDelete() {
    if (!data.licence) {
      alert("No Licence to delete.");
      return;
    }

    if (!confirm("Delete this pilot experience?")) return;

    await deleteExperience(data.licence);
    setData(blank);
    await refresh();
  }

  return (
    <div className={`pe-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header">
        <div>
          <h1>Pilot Experience Builder</h1>
          <p>Build 0016 Production PDF Parser / Smart Column Mapping → Manual Edit → Save</p>
        </div>

        <div className="header-tools">
          <button className="primary" onClick={handleImportPdf}>
            {loading ? "Loading PDF..." : "Load PDF"}
          </button>
          <button onClick={() => setData(blank)}>New / Clear</button>
{!online && <OnlineOnlyNotice what="ประสบการณ์นักบิน" />}
                    <button className="primary needs-online" onClick={handleSave} disabled={!online} title={!online ? "ต้องมีอินเทอร์เน็ตจึงจะบันทึกได้" : undefined}>Save Experience</button>
          <button className="danger" onClick={handleDelete}>Delete</button>
          {/* Prints the sheet only, A4 landscape, with the photo and a
              signature block - see the @media print rules in the CSS. */}
          <button onClick={() => window.print()} title="Print the experience summary — A4 landscape, with signature block.">
            Print / Save PDF
          </button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      <div className="saved-strip">
        {saved.length === 0 && <span>No saved pilot yet.</span>}
        {saved.map((p) => (
          <button key={p.licence} onClick={() => handleLoad(p.licence)}>
            {p.name || p.code || "-"}
            <small>{p.licence}</small>
          </button>
        ))}
      </div>

      <section className="paper" ref={printRef} style={printFitVars}>
        <div className="paper-head">
          <ImageBox label="LOGO" image={data.logo} onFile={(file) => setImage("logo", file)} onRemove={() => removeImage("logo")} />

          <div className="title-area">
            <h2>Pilot experience summary</h2>
            <div className="line">Code : <input value={data.code} onChange={(e) => update("code", e.target.value)} /></div>
            <div className="line">Name : <input value={data.name} onChange={(e) => update("name", e.target.value)} /></div>
            <div className="line">Licence No. <input value={data.licence} onChange={(e) => update("licence", e.target.value)} /></div>
            <div className="line">HBD : <input value={data.hbd} onChange={(e) => update("hbd", e.target.value)} placeholder="1-Mar-73" /></div>
            <div className="line">Position :
              <select value={data.position} onChange={(e) => update("position", e.target.value)}>
                {POSITIONS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <ImageBox label="PHOTO" image={data.photo} onFile={(file) => setImage("photo", file)} onRemove={() => removeImage("photo")} />
        </div>

        <div className="top-grid">
          <table>
            <thead><tr><th>Specialty</th><th>Hours</th></tr></thead>
            <tbody>
              {data.specialty.map((row, i) => (
                <tr key={i}>
                  <td>{row[0]}</td>
                  <td><input value={row[1]} onChange={(e) => updateSpecialty(i, e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <table>
            <thead><tr><th>Sim.Type</th><th>Date Last Attended</th><th></th></tr></thead>
            <tbody>
              {data.sim.map((row, i) => (
                <tr key={i}>
                  <td><input value={row[0]} onChange={(e) => updateSimulator(i, 0, e.target.value)} /></td>
                  <td><input value={row[1]} onChange={(e) => updateSimulator(i, 1, e.target.value)} /></td>
                  <td><button onClick={() => deleteSimulator(i)}>X</button></td>
                </tr>
              ))}
              <tr><td colSpan="3"><button onClick={addSimulator}>+ Add Simulator</button></td></tr>
            </tbody>
          </table>
        </div>

        <p><b>Note:</b> PIC = Pilot-in-Command / Captain &nbsp;&nbsp; SIC = Second-in-Command / Co-pilot</p>

        <div className="exp-grid">
          <ExperienceTable title="Rotary-Wing" subTitle="(S-Engine)" group="rotarySingle" rows={data.rotarySingle} update={updateAircraft} add={addAircraft} del={deleteAircraft} />
          <ExperienceTable title="Fixed-Wing" subTitle="(S-Engine)" group="fixedSingle" rows={data.fixedSingle} update={updateAircraft} add={addAircraft} del={deleteAircraft} />
          <ExperienceTable title="Rotary-Wing" subTitle="(Multi-Engine)" group="rotaryMulti" rows={data.rotaryMulti} update={updateAircraft} add={addAircraft} del={deleteAircraft} />
          <ExperienceTable title="Fixed-Wing" subTitle="(Multi-Engine)" group="fixedMulti" rows={data.fixedMulti} update={updateAircraft} add={addAircraft} del={deleteAircraft} />
        </div>

        <div className="summary six"><b>Total PIC</b><span>{totals.pic}</span><b>Total PICUS</b><span>{totals.picus}</span><b>Total SIC</b><span>{totals.sic}</span></div>
        <div className="summary four"><b>Total of Helicopter</b><span>{totals.helicopter}</span><b>Total of Fixed-wing</b><span>{totals.fixed}</span></div>
        <div className="grand"><span>Grand Total Hours</span><b>{totals.grand}</b></div>

        <div className="footer">
          Update : <input value={data.update} onChange={(e) => update("update", e.target.value)} />
          <span>Signature : _____________________</span>
          <span>FOM/CP/TM</span>
        </div>

        {/* Certification block, print-only and shaped like the Logbook's so the
            two documents read as a set. The screen keeps the compact footer
            above (it is an editor); paper gets ruled lines to sign on, because
            an experience summary is only worth anything as a record if it says
            who certified it. */}
        <div className="pe-certify">
          <div className="pe-certify-text">
            I certify that the experience recorded in this summary is true and correct.
            {data.update ? <>{"  "}Figures updated: <b>{data.update}</b>.</> : null}
            {" "}FOM / CP / TM.
          </div>
          <div className="pe-certify-sigs">
            <div>
              <div className="pe-sigline" />
              <span>Pilot — {data.name || ""}</span>
            </div>
            <div>
              <div className="pe-sigline" />
              <span>Chief Pilot / Authorised Signatory</span>
            </div>
            <div>
              <div className="pe-sigline" />
              <span>Date</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ImageBox({ label, image, onFile, onRemove }) {
  return (
    <div className="image-wrap">
      <div className="image-box">{image ? <img src={image} /> : label}</div>
      <div className="image-box-actions">
        <label className="upload-btn">
          Upload
          <input hidden type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {image && <button type="button" className="remove-btn" onClick={onRemove}>Remove</button>}
      </div>
    </div>
  );
}

function ExperienceTable({ title, subTitle, group, rows, update, add, del }) {
  const total = [
    sumHours(rows.map((r) => r[1])),
    sumHours(rows.map((r) => r[2])),
    sumHours(rows.map((r) => r[3])),
    sumHours(rows.map((r) => r[4]))
  ];

  return (
    <table>
      <thead>
        <tr><th rowSpan="2">{title}<br /><span>{subTitle}</span></th><th colSpan="5">Hours</th></tr>
        <tr><th>PIC</th><th>PICUS</th><th>SIC</th><th>Total Type</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {[0, 1, 2, 3, 4].map((c) => (
              <td key={c}><input readOnly={c === 4} value={row[c]} onChange={(e) => update(group, i, c, e.target.value)} /></td>
            ))}
            <td><button onClick={() => del(group, i)}>X</button></td>
          </tr>
        ))}
        <tr className="total"><td>Total</td><td>{total[0]}</td><td>{total[1]}</td><td>{total[2]}</td><td>{total[3]}</td><td></td></tr>
        <tr><td colSpan="6"><button onClick={() => add(group)}>+ Add Aircraft</button></td></tr>
      </tbody>
    </table>
  );
}
