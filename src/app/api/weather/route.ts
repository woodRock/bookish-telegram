import { NextResponse } from "next/server";
import { setGlobalDispatcher, Agent } from 'undici';

setGlobalDispatcher(new Agent({
  connect: {
    timeout: 20000,
    family: 4
  }
}));

export async function POST(request: Request) {
  try {
    const { location } = await request.json();

    if (!location) {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }

    // 1. Geocode the location to get latitude and longitude
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
    const geocodeRes = await fetch(geocodeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      },
      signal: AbortSignal.timeout(20000) // 20 second timeout
    });
    const geocodeText = await geocodeRes.text();
    let geocodeData;
    try {
      geocodeData = JSON.parse(geocodeText);
    } catch (error) {
      console.error("Failed to parse geocode JSON response:", geocodeText);
      throw new Error("Failed to parse geocode JSON response");
    }

    if (!geocodeData.results || geocodeData.results.length === 0) {
      return NextResponse.json({ error: `Could not find location: ${location}` }, { status: 404 });
    }

    const { latitude, longitude, name, admin1, country } = geocodeData.results[0];
    const displayLocation = `${name}${admin1 ? `, ${admin1}` : ''}${country ? `, ${country}`: ''}`;

    // 2. Get the weather forecast for the location
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
    const weatherRes = await fetch(weatherUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      },
      signal: AbortSignal.timeout(20000) // 20 second timeout
    });
    const weatherText = await weatherRes.text();
    let weatherData;
    try {
      weatherData = JSON.parse(weatherText);
    } catch (error) {
      console.error("Failed to parse weather JSON response:", weatherText);
      throw new Error("Failed to parse weather JSON response");
    }

    if (!weatherData.current_weather) {
      return NextResponse.json({ error: "Could not fetch weather data." }, { status: 500 });
    }

    const { temperature, windspeed, weathercode } = weatherData.current_weather;

    const weatherDescription = getWeatherDescription(weathercode);

    const weatherReport = `The current weather in ${displayLocation} is:
- Temperature: ${temperature}°C
- Wind Speed: ${windspeed} km/h
- Conditions: ${weatherDescription}`;

    return NextResponse.json({ weatherReport });

  } catch (error) {
    console.error("Error in weather API:", error);
    return NextResponse.json(
      { error: "Failed to get weather information" },
      { status: 500 }
    );
  }
}

function getWeatherDescription(code: number): string {
    const descriptions: { [key: number]: string } = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        56: "Light freezing drizzle",
        57: "Dense freezing drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        66: "Light freezing rain",
        67: "Heavy freezing rain",
        71: "Slight snow fall",
        73: "Moderate snow fall",
        75: "Heavy snow fall",
        77: "Snow grains",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        85: "Slight snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail",
    };
    return descriptions[code] || "Unknown weather code";
}
