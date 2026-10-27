import test from 'node:test';
import assert from 'node:assert/strict';
import { planVaultImport } from '../src/lib/vaultBackup';

// Imports must be cloud-legal the moment they are kept: the Firestore rules
// cap note titles at 300 chars and folder names at 200, and an unclamped
// import would sit in the sync outbox being rejected forever.
test('import clamps note titles and folder names to the cloud limits', () => {
  const plan = planVaultImport({
    format: 'uninote-vault', version: 2,
    folders: [{ id: 'f1', name: 'F'.repeat(400), parentId: null }],
    notes: [{ id: 'n1', folderId: 'f1', title: 'T'.repeat(500), sections: [{ id: 's1', title: 'S', content: 'body' }] }]
  }, 'dest');
  assert.equal(plan.folders[0].name.length, 200);
  assert.equal(plan.notes[0].title.length, 300);
  assert.equal(plan.notes[0].sections[0].content, 'body');
});

test('import keeps ordinary titles untouched', () => {
  const plan = planVaultImport({ title: 'Short', content: 'hello' }, 'dest');
  assert.equal(plan.notes[0].title, 'Short');
});
