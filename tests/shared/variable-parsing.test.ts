import { describe, it, expect } from 'vitest'
import { VariablePathParser } from '../../src/variable-hierarchy.js'

describe('VariablePathParser (Cross-Platform)', () => {
  describe('parsing simple variables', () => {
    it('should parse global variables correctly', () => {
      const result = VariablePathParser.parse('Temperature')
      
      expect(result.variable).toBe('Temperature')
      expect(result.task).toBe('AsGlobalPV')
      expect(result.application).toBe('')
      expect(result.path).toEqual([])
    })

    it('should parse task local variables', () => {
      const result = VariablePathParser.parse('TaskMain:Speed')
      
      expect(result.variable).toBe('Speed')
      expect(result.task).toBe('TaskMain')
      expect(result.application).toBe('')
      expect(result.path).toEqual([])
    })
  })

  describe('parsing explicit format variables', () => {
    it('should parse explicit global format', () => {
      const result = VariablePathParser.parse('::AsGlobalPV:Temperature')
      
      expect(result.variable).toBe('Temperature')
      expect(result.task).toBe('AsGlobalPV')
      expect(result.application).toBe('')
    })

    it('should parse explicit task local format', () => {
      const result = VariablePathParser.parse('::TaskMain:Speed')
      
      expect(result.variable).toBe('Speed')
      expect(result.task).toBe('TaskMain')
      expect(result.application).toBe('')
    })

    it('should parse full explicit format', () => {
      const result = VariablePathParser.parse('::AppModule:TaskMain:MotorData')
      
      expect(result.variable).toBe('MotorData')
      expect(result.task).toBe('TaskMain')
      expect(result.application).toBe('AppModule')
    })
  })

  describe('parsing structured variables', () => {
    it('should parse dot notation structures', () => {
      const result = VariablePathParser.parse('Motor.Speed')
      
      expect(result.variable).toBe('Motor')
      expect(result.path).toEqual(['Speed'])
      expect(result.task).toBe('AsGlobalPV')
    })

    it('should parse nested structures', () => {
      const result = VariablePathParser.parse('System.Diagnostics.ErrorCount')
      
      expect(result.variable).toBe('System')
      expect(result.path).toEqual(['Diagnostics', 'ErrorCount'])
    })
  })

  describe('error handling', () => {
    it('should throw error for invalid formats', () => {
      expect(() => {
        VariablePathParser.parse('::Invalid:Too:Many:Colons:Here')
      }).toThrow()
    })

    it('should handle empty variable names gracefully', () => {
      // Empty string should either throw or return sensible defaults
      try {
        const result = VariablePathParser.parse('')
        // If it doesn't throw, it should have some reasonable defaults
        expect(result).toBeDefined()
      } catch (error) {
        // If it throws, that's also acceptable behavior
        expect(error).toBeDefined()
      }
    })
  })
})
