import test from 'node:test';
import assert from 'node:assert';
import { setGlobalDispatcher, Agent } from 'undici';

setGlobalDispatcher(new Agent({
  connect: {
    timeout: 20000,
    family: 4
  }
}));

test('fetch should be able to fetch a known good URL', async () => {
  const response = await fetch('https://www.google.com');
  assert.ok(response.ok, 'response should be ok');
});

test('fetch should be able to fetch the Nominatim API', async () => {
  const geocodeUrl = 'https://nominatim.openstreetmap.org/search?q=London&format=json&limit=1';
  const response = await fetch(geocodeUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
    }
  });
  assert.ok(response.ok, 'response should be ok');
  const data = await response.json();
  assert.ok(Array.isArray(data) && data.length > 0, 'should return an array with at least one result');
});

test('fetch should be able to fetch the Open-Meteo weather API', async () => {
  const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current_weather=true';
  const response = await fetch(weatherUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
    }
  });
  assert.ok(response.ok, 'response should be ok');
  const data = await response.json();
  assert.ok(data.hasOwnProperty('current_weather'), 'should return a current_weather property');
});