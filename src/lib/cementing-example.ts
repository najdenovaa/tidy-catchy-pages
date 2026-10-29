// Пример из руководства «Быстрый старт» (раздел 3): эксплуатационная колонна 168,3×8,9 мм в стволе 215,9 мм,
// наклонно-направленная скважина, два пласта, облегчённый + нормальный цемент.
import { normalizeCementingSnapshot, type CementingSnapshot } from "@/lib/cementing-normalizers";

const raw = {
  "wellData": {
    "wellDepthMD": 2520,
    "wellDepthTVD": 2380,
    "casingDepthMD": 2515,
    "holeDiameter": 215.9,
    "casingOD": 168.3,
    "casingWall": 8.9,
    "prevCasingDepth": 520,
    "prevCasingOD": 244.5,
    "prevCasingID": 226.6,
    "ckodDepth": 2495,
    "cementRiseHeight": 2165,
    "cavernCoeff": 1.15,
    "bottomTempStatic": 78,
    "bottomTempCirc": 58,
    "pumpZoneTop": 1650,
    "pumpZoneBottom": 1750,
    "trajectory": [
      {
        "md": 0,
        "tvd": 0,
        "zenith": 0,
        "azimuth": 0
      },
      {
        "md": 500,
        "tvd": 500,
        "zenith": 0,
        "azimuth": 0
      },
      {
        "md": 900,
        "tvd": 890,
        "zenith": 12,
        "azimuth": 110
      },
      {
        "md": 1300,
        "tvd": 1270,
        "zenith": 22,
        "azimuth": 112
      },
      {
        "md": 2000,
        "tvd": 1910,
        "zenith": 24,
        "azimuth": 112
      },
      {
        "md": 2520,
        "tvd": 2380,
        "zenith": 25,
        "azimuth": 113
      }
    ],
    "reservoirLayers": [
      {
        "name": "АВ1",
        "topMD": 2380,
        "bottomMD": 2420,
        "porePressureGrad": 10.2,
        "fracGrad": 18.6,
        "absorbGrad": 17.2,
        "fluidType": "нефть"
      },
      {
        "name": "БВ8",
        "topMD": 2460,
        "bottomMD": 2490,
        "porePressureGrad": 10.4,
        "fracGrad": 18.8,
        "absorbGrad": 17.4,
        "fluidType": "нефть"
      }
    ]
  },
  "drillingFluid": {
    "name": "Полимерглинистый",
    "density": 1180,
    "rheology": {
      "pv": 18,
      "yp": 9
    },
    "fluidLoss": 6
  },
  "buffers": [
    {
      "name": "Моющий буфер",
      "bufferType": "chemical_wash",
      "density": 1020,
      "volume": 4,
      "rheology": {
        "pv": 2,
        "yp": 0
      },
      "additives": [],
      "flowRateSteps": [
        {
          "rateLps": 8,
          "volumeM3": 4
        }
      ]
    },
    {
      "name": "Утяжелённый спейсер",
      "bufferType": "weighted",
      "density": 1300,
      "volume": 6,
      "rheology": {
        "pv": 25,
        "yp": 12
      },
      "additives": [],
      "flowRateSteps": [
        {
          "rateLps": 8,
          "volumeM3": 6
        }
      ]
    }
  ],
  "slurries": [
    {
      "name": "Облегчённый ПЦТ-III-Об",
      "density": 1.45,
      "topDepthMD": 350,
      "rheology": {
        "pv": 45,
        "yp": 10
      },
      "additives": [],
      "thickeningTime30Bc": 240,
      "thickeningTime50Bc": 270,
      "flowRateSteps": [
        {
          "rateLps": 8,
          "volumeM3": 36.43
        }
      ],
      "waterRatio": 1.0,
      "yieldPerTon": 1.35,
      "washVolume": 0
    },
    {
      "name": "ПЦТ-I-G нормальный",
      "density": 1.9,
      "topDepthMD": 2200,
      "rheology": {
        "pv": 70,
        "yp": 12
      },
      "additives": [],
      "thickeningTime30Bc": 180,
      "thickeningTime50Bc": 200,
      "flowRateSteps": [
        {
          "rateLps": 8,
          "volumeM3": 6.82
        }
      ],
      "waterRatio": 0.44,
      "yieldPerTon": 0.76
    }
  ],
  "displacementFluids": [
    {
      "name": "Техническая вода",
      "density": 1000,
      "rheology": {
        "pv": 1,
        "yp": 0
      },
      "flowRateSteps": [
        {
          "rateLps": 10,
          "volumeM3": 40
        },
        {
          "rateLps": 5,
          "volumeM3": 5.7
        }
      ],
      "compressionCoeff": 1.03
    }
  ],
  "fractureGradient": 17.7,
  "flushTimeMin": 10,
  "flushVolumeM3": 0
};

export function getCementingExample(): CementingSnapshot {
  return normalizeCementingSnapshot(JSON.parse(JSON.stringify(raw)));
}
