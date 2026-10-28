import MyExperience from "./MyExperience.jsx";

// Shared Admin presentation of the Crew app's read-only My Experience page.
// Keeping this wrapper in one module lets both Admin navigation entry points
// render the exact same pilot selector and cumulative-hours calculation.
export default function PilotExperienceSummary() {
  return (
    <MyExperience
      title="Pilot Experience Summary"
      description="Select a pilot to view their cumulative experience summary. Current totals include Daily Duty records flown after the saved update date."
    />
  );
}
