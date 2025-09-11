
TYPE
	TestStruct : 	STRUCT 
		command : BOOL;
		slider : REAL;
		random : REAL;
		struct2 : TestStruct1;
		struct3 : TestStruct1;
		struct1 : TestStruct1;
		myvalue : TestStruct3;
	END_STRUCT;
	TestStruct1 : 	STRUCT 
		struct1 : TestStruct2;
		struct2 : TestStruct2;
	END_STRUCT;
	TestStruct2 : 	STRUCT 
		member : BOOL;
		member1 : INT;
		member2 : DINT;
		member3 : STRING[80];
	END_STRUCT;
	TestStruct3 : 	STRUCT 
		x : REAL;
	END_STRUCT;
	TestSimpleArray : 	STRUCT 
		reals : ARRAY[0..2]OF REAL;
		ints : ARRAY[0..2]OF INT;
	END_STRUCT;
	TestOffsetArray : 	STRUCT 
		standard : ARRAY[0..2]OF REAL;
		offset : ARRAY[1..3]OF REAL;
	END_STRUCT;
	TestArrays : 	STRUCT 
		doubleArray : {REDUND_UNREPLICABLE} ARRAY[0..3,0..3]OF TestStruct2;
		doubleArrayOffset : {REDUND_UNREPLICABLE} ARRAY[1..3,1..3]OF TestStruct2;
		TestOffsetArray : TestOffsetArray;
		New_Member1 : TestSimpleArray;
	END_STRUCT;
END_TYPE
