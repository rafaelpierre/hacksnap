"""Regression contracts for the collector's production release wiring."""
import fnmatch
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def workflow(name):
    # BaseLoader preserves GitHub's YAML `on` key rather than YAML 1.1 booleans.
    return yaml.load((ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)


class IngestionDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.config = workflow('ingestion-deploy.yml')
        self.jobs = self.config['jobs']

    def matches_push(self, path):
        return any(fnmatch.fnmatchcase(path, pattern)
                   for pattern in self.config['on']['push']['paths'])

    def test_production_changes_trigger_main_pushes(self):
        self.assertEqual(self.config['on']['push']['branches'], ['main'])
        for path in ('data/src/hn_trending/client.py', 'data/modal_app.py',
                     'data/pyproject.toml', 'data/uv.lock', 'data/alembic.ini',
                     'data/migrations/versions/example.py',
                     '.github/workflows/ingestion.yml', '.github/workflows/ingestion-deploy.yml',
                     '.github/workflows/supabase-schema.yml',
                     '.github/scripts/deploy-modal.sh', '.github/scripts/migrate-schema.sh'):
            with self.subTest(path=path):
                self.assertTrue(self.matches_push(path))

    def test_unrelated_and_test_only_pushes_do_not_deploy(self):
        for path in ('data/README.md', 'data/tests/test_cli.py', 'hacksnap/modal_app.py',
                     'hacksnap/web/app/page.tsx', '.github/tests/ingestion_deploy_contract.py'):
            with self.subTest(path=path):
                self.assertFalse(self.matches_push(path))

    def test_production_is_main_push_or_manual_only(self):
        expected = ("github.ref == 'refs/heads/main' && "
                    "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')")
        for job in ('schema', 'deploy'):
            self.assertEqual(' '.join(self.jobs[job]['if'].split()), expected)
        self.assertIn('pull_request', self.config['on'])
        self.assertIn('workflow_dispatch', self.config['on'])
        self.assertNotIn('workflow_call', self.config['on'])
        self.assertEqual(set(workflow('ingestion.yml')['jobs']), {'test'})

    def test_all_validation_and_schema_gates_precede_deployment(self):
        self.assertEqual(self.jobs['test']['uses'], './.github/workflows/ingestion.yml')
        self.assertEqual(set(self.jobs['schema']['needs']), {'test', 'deployment_tests'})
        self.assertEqual(self.jobs['schema']['uses'], './.github/workflows/supabase-schema.yml')
        self.assertEqual(self.jobs['schema']['with']['apply_migrations'], 'true')
        self.assertEqual(set(self.jobs['deploy']['needs']), {'test', 'deployment_tests', 'schema'})
        schema = workflow('supabase-schema.yml')['jobs']['migrate']
        self.assertEqual(schema['concurrency']['group'], 'supabase-schema-production')

    def test_target_environment_and_deployment_lock(self):
        deploy = self.jobs['deploy']
        self.assertEqual(deploy['environment'], 'hacksnap-production')
        self.assertEqual(deploy['concurrency'], {
            'group': 'hn-ingestion-modal-deploy', 'cancel-in-progress': 'false',
        })
        steps = deploy['steps']
        preflight = next(step for step in steps if 'schema deployment' in step.get('name', ''))
        publish = next(step for step in steps if 'Deploy the scheduled' in step.get('name', ''))
        self.assertLess(steps.index(preflight), steps.index(publish))
        self.assertIn('versions != expected', preflight['run'])
        self.assertEqual(publish['working-directory'], 'data')
        self.assertEqual(publish['run'], 'bash ../.github/scripts/deploy-modal.sh')
        self.assertEqual(publish['env']['GH_TOKEN'], '${{ github.token }}')
        self.assertIn('MODAL_TOKEN_ID', publish['env'])
        self.assertIn('MODAL_TOKEN_SECRET', publish['env'])
        for job in ('test', 'deployment_tests'):
            self.assertNotIn('secrets', self.jobs[job])
            self.assertNotIn('environment', self.jobs[job])


if __name__ == '__main__':
    unittest.main()
