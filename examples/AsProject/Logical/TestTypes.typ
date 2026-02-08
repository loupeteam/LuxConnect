(*
================================================================================
OPC UA Type Coverage Test Type Definitions
================================================================================
Structure type definitions for comprehensive OPC UA type testing

SETUP INSTRUCTIONS:
1. Import this .typ file into your PLC project data types
2. Import TestTypes.var for variable declarations
3. Map variables to OPC UA namespace 5

These structures are designed to test:
- Mixed primitive types in structures
- Nested structures
- Arrays of structures
- Deep field access (struct.member.submember)
================================================================================
*)

TYPE
    (* ====================================================================== *)
    (* Inner Structure for Nested Testing                                    *)
    (* ====================================================================== *)
    InnerStruct : STRUCT
        value : INT := 0;           (* Nested integer value *)
        enabled : BOOL := FALSE;    (* Nested boolean flag *)
    END_STRUCT;
    
    (* ====================================================================== *)
    (* Outer Structure Containing Inner Structure                            *)
    (* Tests: nestedStruct.inner.value access pattern                        *)
    (* ====================================================================== *)
    OuterStruct : STRUCT
        id : DINT := 0;             (* Outer level ID *)
        name : STRING[40] := '';    (* Outer level name *)
        inner : InnerStruct;        (* Nested structure *)
    END_STRUCT;
    
    (* ====================================================================== *)
    (* Structure with All Primitive Types                                    *)
    (* Tests: Reading/writing structures with mixed data types               *)
    (* Also tests individual member access: allTypesStruct.intVal, etc.      *)
    (* ====================================================================== *)
    AllTypesStruct : STRUCT
        intVal : INT := 0;          (* Signed 16-bit integer *)
        floatVal : REAL := 0.0;     (* 32-bit floating point *)
        boolVal : BOOL := FALSE;    (* Boolean value *)
        strVal : STRING[40] := '';  (* String value *)
        uint16Val : UINT := 0;      (* Unsigned 16-bit integer *)
        sint8Val : SINT := 0;       (* Signed 8-bit integer *)
        lrealVal : LREAL := 0.0;    (* 64-bit floating point *)
    END_STRUCT;
    
END_TYPE
