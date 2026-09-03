export interface SemanticMapping {
  capabilityId: string;
  confidence: number;
  reason: string;
}

const VENDOR_PATTERNS: Array<{ pattern: RegExp; capabilityId: string; confidence: number }> = [
  {
    pattern: /\b(set[_-]?temp(?:erature)?|temperature[_-]?set|SET\s*TEMP)\b/i,
    capabilityId: 'temperature.set',
    confidence: 0.92,
  },
  {
    pattern: /\b(get[_-]?temp(?:erature)?|read[_-]?temp(?:erature)?|GET\s*TEMP)\b/i,
    capabilityId: 'temperature.read',
    confidence: 0.92,
  },
  {
    pattern: /\b(read[_-]?humidity|get[_-]?humidity|humidity[_-]?read)\b/i,
    capabilityId: 'humidity.read',
    confidence: 0.9,
  },
  {
    pattern: /\b(open[_-]?door|door[_-]?open|OPEN_DOOR)\b/i,
    capabilityId: 'door.open',
    confidence: 0.9,
  },
  {
    pattern: /\b(close[_-]?door|door[_-]?close|CLOSE_DOOR)\b/i,
    capabilityId: 'door.close',
    confidence: 0.9,
  },
  {
    pattern: /\b(experiment[_-]?start|start[_-]?experiment)\b/i,
    capabilityId: 'experiment.start',
    confidence: 0.88,
  },
  {
    pattern: /\b(experiment[_-]?stop|stop[_-]?experiment)\b/i,
    capabilityId: 'experiment.stop',
    confidence: 0.88,
  },
  {
    pattern: /\b(move[_-]?to|moveTo|set[_-]?pose|moveXYZ)\s*\(/i,
    capabilityId: 'motion.move_to',
    confidence: 0.9,
  },
  { pattern: /\b(home|homing)\s*\(/i, capabilityId: 'motion.home', confidence: 0.88 },
  { pattern: /\b(stop|emergency[_-]?stop)\s*\(/i, capabilityId: 'motion.stop', confidence: 0.85 },
  {
    pattern: /\b(gripper[_-]?open|open[_-]?gripper)\b/i,
    capabilityId: 'gripper.open',
    confidence: 0.88,
  },
  {
    pattern: /\b(gripper[_-]?close|close[_-]?gripper)\b/i,
    capabilityId: 'gripper.close',
    confidence: 0.88,
  },
  { pattern: /\b(status|health|ping)\b/i, capabilityId: 'status.read', confidence: 0.75 },
  { pattern: /\bgpio[_-]?write\b/i, capabilityId: 'gpio.write', confidence: 0.95 },
  { pattern: /\bgpio[_-]?read\b/i, capabilityId: 'gpio.read', confidence: 0.95 },
  {
    pattern: /\b(set[_-]?speed|motor[_-]?set|set[_-]?motor)\b/i,
    capabilityId: 'motor.set',
    confidence: 0.9,
  },
  {
    pattern: /\b(motor[_-]?stop|stop[_-]?motor)\b/i,
    capabilityId: 'motor.stop',
    confidence: 0.88,
  },
  {
    pattern: /\b(set[_-]?angle|servo[_-]?write|write[_-]?angle)\b/i,
    capabilityId: 'servo.set_angle',
    confidence: 0.9,
  },
  {
    pattern: /\b(stepper[_-]?step|step\s*\(|relative[_-]?step)\b/i,
    capabilityId: 'stepper.step',
    confidence: 0.88,
  },
  {
    pattern: /\b(stepper[_-]?goto|goto[_-]?position|move[_-]?steps)\b/i,
    capabilityId: 'stepper.goto',
    confidence: 0.86,
  },
  {
    pattern: /\b(i2c[_-]?write|wire[_-]?write)\b/i,
    capabilityId: 'i2c.write',
    confidence: 0.9,
  },
  {
    pattern: /\b(i2c[_-]?read|wire[_-]?read)\b/i,
    capabilityId: 'i2c.read',
    confidence: 0.9,
  },
  {
    pattern: /\b(spi[_-]?transfer|spi[_-]?write)\b/i,
    capabilityId: 'spi.transfer',
    confidence: 0.88,
  },
  {
    pattern: /\b(read[_-]?distance|get[_-]?distance|ultrasonic[_-]?read|distance[_-]?read)\b/i,
    capabilityId: 'distance.read',
    confidence: 0.9,
  },
  {
    pattern: /(\bset[_-]?voltage\b|\bvoltage[_-]?set\b|(?<!MEAS:)\bVOLT\b(?!\?))/i,
    capabilityId: 'voltage.set',
    confidence: 0.88,
  },
  {
    pattern: /\b(read[_-]?voltage|measure[_-]?voltage|voltage[_-]?read|MEAS:VOLT)\b/i,
    capabilityId: 'voltage.read',
    confidence: 0.88,
  },
  {
    pattern: /(\bset[_-]?current\b|\bcurrent[_-]?set\b|(?<!MEAS:)\bCURR\b(?!\?))/i,
    capabilityId: 'current.set',
    confidence: 0.88,
  },
  {
    pattern: /\b(read[_-]?current|measure[_-]?current|current[_-]?read|MEAS:CURR)\b/i,
    capabilityId: 'current.read',
    confidence: 0.88,
  },
  {
    pattern: /\b(output[_-]?enable|enable[_-]?output|\bOUTP\b)\b/i,
    capabilityId: 'power.output.enable',
    confidence: 0.85,
  },
  {
    pattern: /\b(read[_-]?temperature|temperature[_-]?read|get[_-]?setpoint|read[_-]?setpoint)\b/i,
    capabilityId: 'temperature.read',
    confidence: 0.85,
  },
  {
    pattern: /\b(set[_-]?point|setpoint[_-]?set|set[_-]?setpoint|write[_-]?setpoint)\b/i,
    capabilityId: 'temperature.set',
    confidence: 0.78,
  },
  {
    pattern: /\bpump[._-]?run\b|\bpump[_-]?start\b/i,
    capabilityId: 'pump.run',
    confidence: 0.8,
  },
  {
    pattern: /\b(start[_-]?cycle|cycle[_-]?start)\b/i,
    capabilityId: 'cycle.start',
    confidence: 0.82,
  },
  {
    pattern: /\b(set[_-]?payload|payload[_-]?set)\b/i,
    capabilityId: 'payload.set',
    confidence: 0.8,
  },
  {
    pattern: /\b(move[_-]?joint|joint[_-]?move)\b/i,
    capabilityId: 'motion.move_joint',
    confidence: 0.9,
  },
  {
    pattern: /\b(get[_-]?pose|read[_-]?pose|pose[_-]?read|get[_-]?position)\b/i,
    capabilityId: 'pose.read',
    confidence: 0.88,
  },
  {
    pattern: /\b(set[_-]?pwm|pwm[_-]?write|pwm[_-]?configure)\b/i,
    capabilityId: 'pwm.write',
    confidence: 0.9,
  },
  {
    pattern: /\b(read[_-]?imu|get[_-]?accel|read[_-]?gyro)\b/i,
    capabilityId: 'imu.read',
    confidence: 0.88,
  },
  {
    pattern: /\b(read[_-]?encoder|encoder[_-]?count|get[_-]?ticks)\b/i,
    capabilityId: 'encoder.read',
    confidence: 0.88,
  },
  {
    pattern: /\b(read[_-]?limit|limit[_-]?switch|end[_-]?stop)\b/i,
    capabilityId: 'limit.read',
    confidence: 0.86,
  },
  {
    pattern: /\b(read[_-]?force|load[_-]?cell|get[_-]?newtons)\b/i,
    capabilityId: 'force.read',
    confidence: 0.88,
  },
  {
    pattern: /\b(set[_-]?velocity|cmd[_-]?vel|set[_-]?twist|drive[_-]?set)\b/i,
    capabilityId: 'drive.set_velocity',
    confidence: 0.9,
  },
  {
    pattern: /\b(drive[_-]?stop|stop[_-]?base)\b/i,
    capabilityId: 'drive.stop',
    confidence: 0.86,
  },
];

export function mapVendorSymbol(symbol: string): SemanticMapping | undefined {
  const candidates = [symbol, `${symbol}(`];
  for (const candidate of candidates) {
    for (const entry of VENDOR_PATTERNS) {
      if (entry.pattern.test(candidate)) {
        return {
          capabilityId: entry.capabilityId,
          confidence: entry.confidence,
          reason: `Matched pattern ${entry.pattern.source} for '${symbol}'`,
        };
      }
    }
  }
  const normalized = symbol.replace(/[^a-zA-Z0-9]+/g, '.').toLowerCase();
  if (normalized.includes('temp') && normalized.includes('set')) {
    return { capabilityId: 'temperature.set', confidence: 0.7, reason: 'Heuristic temp+set' };
  }
  if (normalized.includes('vendor') || normalized.length < 3) {
    return undefined;
  }
  return {
    capabilityId: `vendor.${normalized}`,
    confidence: 0.55,
    reason: 'No semantic family match; using vendor namespace',
  };
}

export function inferDeviceClass(text: string): string | undefined {
  if (/environmental[_\s-]?chamber|heatbox|chamber/i.test(text)) {
    return 'lab.environmental_chamber';
  }
  if (/mobile[_-\s]?base|differential[_-\s]?drive|\bcmd_vel\b/i.test(text)) {
    return 'robot.mobile_base';
  }
  if (/robot|manipulator|actuator|arm/i.test(text) && !/dc\s*motor|stepper|servo/i.test(text)) {
    return 'robot.manipulator';
  }
  if (/\bdc\s*motor\b|brushed\s*motor/i.test(text)) {
    return 'actuator.dc_motor';
  }
  if (/\bstepper\b/i.test(text)) {
    return 'actuator.stepper';
  }
  if (/\bservo\b/i.test(text)) {
    return 'actuator.servo';
  }
  if (/rangefinder|ultrasonic|tof|time[_-]?of[_-]?flight|lidar/i.test(text)) {
    return 'sensor.distance';
  }
  if (/\bimu\b|accelerometer|gyroscope/i.test(text)) {
    return 'sensor.imu';
  }
  if (/\bencoder\b|quadrature/i.test(text)) {
    return 'sensor.encoder';
  }
  if (/limit[_-\s]?switch|end[_-\s]?stop/i.test(text)) {
    return 'sensor.limit_switch';
  }
  if (/load[_-\s]?cell|force[_-\s]?sensor/i.test(text)) {
    return 'sensor.force';
  }
  if (/thermometer|temperature sensor|humidity sensor/i.test(text)) {
    return 'sensor.temperature';
  }
  if (/microcontroller|esp32|gpio/i.test(text)) {
    return 'microcontroller';
  }
  return undefined;
}
