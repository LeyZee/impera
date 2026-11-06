/**
 * Checks a persona file against `PersonaSchema` without touching the database (playbook « Modifier la persona »).
 * Usage: `pnpm persona:validate <fichier.yaml>`.
 */
import { requireArguments } from './command-line';
import { describeIssues, readPersonaYaml } from './persona-file';

requireArguments('Usage: pnpm persona:validate <fichier.yaml>', { positionals: true });
const [path] = process.argv.slice(2).filter((arg) => arg !== '--');
if (path === undefined) {
  console.error('Usage: pnpm persona:validate <fichier.yaml>');
  process.exit(1);
}

const result = await readPersonaYaml(path).catch((error: unknown) => {
  console.error(`Lecture impossible : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
if (result.success) {
  console.log(`Persona valide : version ${result.data.meta.version}.`);
} else {
  console.error(`Persona invalide (${String(result.error.issues.length)} problème(s)) :`);
  for (const line of describeIssues(result.error)) console.error(line);
  process.exitCode = 1;
}
