import type { ConnectionConfig } from '../../src/types.js'

export const mockConnectionConfig: ConnectionConfig = {
  protocol: 'https',
  host: 'localhost',
  port: 8443,
  username: 'test',
  password: 'test'
}

export const mockVariables = {
  simple: [
    'Temperature',
    'Pressure', 
    'Speed'
  ],
  hierarchical: [
    '::AsGlobalPV:GlobalTemp',
    'TaskMain:LocalVar',
    'Motor.Speed',
    'Motor.Current',
    'System.Diagnostics.ErrorCount'
  ],
  complex: [
    '::AppModule:TaskMain:MotorData.Speed',
    '::AppModule:TaskMain:MotorData.Current',
    '::AppModule:AsGlobalPV:SystemStatus'
  ]
}

export const mockNodeIds = {
  'Temperature': 'ns=5;s=Temperature',
  'Pressure': 'ns=5;s=Pressure',
  'Speed': 'ns=5;s=Speed',
  'Motor.Speed': 'ns=5;s=Motor.Speed',
  'Motor.Current': 'ns=5;s=Motor.Current'
}
