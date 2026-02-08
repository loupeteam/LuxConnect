
PROGRAM _CYCLIC
	int8;// : SINT := 0; (* -128 to 127 *)
	int16;// : INT := 0; (* -32768 to 32767 *)
	int32;// : DINT := 0; (* -2147483648 to 2147483647 *)
	uint8;// : USINT := 0; (* 0 to 255 - also known as BYTE *)
	uint16;// : UINT := 0; (* 0 to 65535 - also known as WORD *)
	uint32;// : UDINT := 0; (* 0 to 4294967295 - also known as DWORD *)
	float32;// : REAL := 0.0; (* 32-bit single precision *)
	float64;// : LREAL := 0.0; (* 64-bit double precision *) (* ====================================================================== *) (* Boolean Type                                                           *)
	bool;// : BOOL := FALSE; (* TRUE or FALSE *) (* ====================================================================== *) (* String Types                                                           *)
	str;// : STRING[80] := ''; (* Standard ASCII string, max 80 chars *)
	wstr;// : WSTRING[80] := ""; (* Wide string (Unicode), max 80 chars *) (* ====================================================================== *) (* Date and Time Types                                                    *)
	dt;// : DATE_AND_TIME; (* Date and time combined *)
	tod;// : TIME_OF_DAY; (* Time of day only *)
	dateonly;// : DATE; (* Date only *) (* ====================================================================== *) (* Array Types - Primitives                                              *)
	intArr;// : ARRAY[0..9] OF INT := [10(0)]; (* Array of 10 integers *)
	realArr;// : ARRAY[0..9] OF REAL := [10(0.0)]; (* Array of 10 floats *)
	boolArr;// : ARRAY[0..9] OF BOOL := [10(FALSE)]; (* Array of 10 booleans *)
	strArr;// : ARRAY[0..4] OF STRING[40] := [5('')]; (* Array of 5 strings *) (* ====================================================================== *) (* Structure with All Primitive Types                                    *)
	allTypesStruct;// : AllTypesStruct := (intVal:=0,floatVal:=0.0,boolVal:=FALSE,strVal:='',uint16Val:=0,sint8Val:=0,lrealVal:=0.0); (* ====================================================================== *) (* Nested Structures                                                      *) (* Tests structure containing another structure                          *)
	nestedStruct;// : OuterStruct := (id:=0,name:='',inner:=(value:=0,enabled:=FALSE)); (* ====================================================================== *) (* Array of Structures                                                    *) (* Tests complex data type arrays                                        *)
	structArr;// : ARRAY[0..4] OF AllTypesStruct := [5((intVal:=0,floatVal:=0.0,boolVal:=FALSE,strVal:='',uint16Val:=0,sint8Val:=0,lrealVal:=0.0))];
		 
END_PROGRAM
