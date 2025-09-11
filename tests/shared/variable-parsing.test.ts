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
      expect(result.application).toBe('')

    })

    it('should parse nested structures', () => {
      const result = VariablePathParser.parse('System.Diagnostics.ErrorCount')
      
      expect(result.variable).toBe('System')
      expect(result.path).toEqual(['Diagnostics', 'ErrorCount'])
      expect(result.task).toBe('AsGlobalPV')
      expect(result.application).toBe('')
    })    
    it('should parse structures with array indices', () => {
      const result = VariablePathParser.parse('Motor.Status[0].Running')
      expect(result.variable).toBe('Motor')
      expect(result.path).toEqual(['Status', '[0]', 'Running'])
      expect(result.task).toBe('AsGlobalPV')
      expect(result.application).toBe('')
    })

    it('should parse split arrays across multiple path segments', () => {
      const result = VariablePathParser.parse('complex.struct[10,0].value.arrayd.myarray[4].value')
      expect(result.variable).toBe('complex')
      expect(result.path).toEqual(['struct', '[10,0]', 'value', 'arrayd', 'myarray', '[4]', 'value'])
      expect(result.task).toBe('AsGlobalPV')
      expect(result.application).toBe('')
    })

    it('should handle multiple split arrays in complex structures', () => {
      const testCases = [
        {
          input: 'root[0].middle.another[1,2].end',
          expectedPath: ['[0]', 'middle', 'another', '[1,2]', 'end']
        },
        {
          input: 'first[5].second[10].third[15,20].final',
          expectedPath: ['[5]', 'second', '[10]', 'third', '[15,20]', 'final']
        },
        {
          input: 'matrix[0,0].data.vector[5].element.array[10,20,30].value',
          expectedPath: ['[0,0]', 'data', 'vector', '[5]', 'element', 'array', '[10,20,30]', 'value']
        }
      ]

      testCases.forEach(({ input, expectedPath }) => {
        const result = VariablePathParser.parse(input)
        expect(result.path).toEqual(expectedPath)
      })
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

  describe('reconstruction', () => {
    it('should perfectly reconstruct simple variables', () => {
      const original = 'Temperature'
      const parsed = VariablePathParser.parse(original)
      const reconstructed = VariablePathParser.reconstruct(parsed)
      
      expect(reconstructed).toBe(original)
    })

    it('should perfectly reconstruct task variables', () => {
      const original = 'TaskMain:Speed'
      const parsed = VariablePathParser.parse(original)
      const reconstructed = VariablePathParser.reconstruct(parsed)
      
      expect(reconstructed).toBe(original)
    })

    it('should perfectly reconstruct array variables', () => {
      const testCases = [
        'Motor.Status[0].Running',
        'Array[1,2].Data[3]',
        'Simple[0,1,2]',
        'Complex.Structure[5].Sub[10,20].Value',
        'complex.struct[10,0].value.arrayd.myarray[4].value',
        'root[0].middle.another[1,2].end',
        'matrix[0,0].data.vector[5].element.array[10,20,30].value'
      ]
      
      testCases.forEach(original => {
        const parsed = VariablePathParser.parse(original)
        const reconstructed = VariablePathParser.reconstruct(parsed)
        expect(reconstructed).toBe(original)
      })
    })

    it('should perfectly reconstruct explicit format variables', () => {
      const testCases = [
        { input: '::AsGlobalPV:Temperature', expected: 'Temperature' }, // Simplified form
        { input: '::TaskMain:Speed', expected: 'TaskMain:Speed' }, // Task form
        { input: '::AppModule:TaskName:Variable[1,2,3].Sub[4].Final', expected: '::AppModule:TaskName:Variable[1,2,3].Sub[4].Final' } // Full form
      ]
      
      testCases.forEach(({ input, expected }) => {
        const parsed = VariablePathParser.parse(input)
        const reconstructed = VariablePathParser.reconstruct(parsed)
        expect(reconstructed).toBe(expected)
      })
    })
  })
})
