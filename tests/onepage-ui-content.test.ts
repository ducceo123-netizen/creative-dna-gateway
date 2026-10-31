import test from 'node:test';
import assert from 'node:assert/strict';
import template from '../templates/onepage-ui-v1.json' with { type: 'json' };
import faq from '../templates/onepage-faq-section-v1.json' with { type: 'json' };
import { ONEPAGE_UI_CONTENT_CONTRACT as contract, validateOnepageUiCopy } from '../supabase/functions/_shared/onepage-ui-content.ts';

test('slot contract matches actual immutable GTK template and FAQ row prototype', () => {
  const sections = contract.sections;
  const common = sections.flatMap(section => section.text_slots || []);
  const post = sections.find(section => section.id === 'post_story')!;
  assert.deepEqual([...common, ...post.text_slots_by_mode!.gtk].sort(), [...template.text_slots].sort());
  assert.deepEqual(post.text_slots_by_mode!.faq.map(slot => slot.replace('NN', '01')).sort(), [...faq.text_slots].sort());
  const copy = Object.fromEntries(template.text_slots.map(slot => [slot, 'Valid product-specific copy']));
  assert.deepEqual(validateOnepageUiCopy(copy, 'gtk', 3), []);
  for (const count of [NaN, Infinity, 0, -1, 1.5, 101]) assert.deepEqual(validateOnepageUiCopy({}, 'faq', count), ['UI_COPY_INVALID_FAQ_COUNT']);
  for (const heading of Object.values(contract.fixed_headings)) assert.ok(template.html.includes(heading));
});

test('captured Occasion pair has no text slot/heading and immediately precedes four icon cards', () => {
  const html = template.html;
  const details = html.indexOf('class="uid-product-content__details"');
  const occasion = html.indexOf('class="uid-product-occasions"');
  const cards = html.indexOf('class="uid-occasions-items"');
  const gtk = html.indexOf('class="uid-product-good-to-know"');
  assert.ok(details < occasion && occasion < cards && cards < gtk);
  const media = html.slice(occasion, cards);
  assert.equal((media.match(/data-asset-slot=/g) || []).length, 2);
  assert.ok(media.includes('data-asset-slot="occasion_story_01"'));
  assert.ok(media.includes('data-asset-slot="occasion_story_02"'));
  assert.doesNotMatch(media, /data-text-slot|uid-product-content-heading/);
  const icons = html.slice(cards, gtk);
  assert.equal((icons.match(/data-asset-slot=/g) || []).length, 4);
  assert.deepEqual([...icons.matchAll(/data-text-slot="([^"]+)"/g)].map(m => m[1]), contract.sections.find(s => s.id === 'occasion_icons')!.text_slots);
});
