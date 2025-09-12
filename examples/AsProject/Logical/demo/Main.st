
PROGRAM _INIT

	test;
	test_arrays;
	
END_PROGRAM

PROGRAM _CYCLIC

	// Increment cycle counter for pseudo-random behavior
	cycle_counter := cycle_counter + 1;
	IF cycle_counter > 1000000 THEN
		cycle_counter := 0;
	END_IF;
	
	// Create pseudo-random selector to choose between structures and manipulation types
	random_selector := cycle_counter MOD 10;  // 10 different cases
	
	CASE random_selector OF
		0, 1, 2, 3, 4: // Manipulate test structure (50% of the time)
			structure_size := SIZEOF(test);
			offset := DINT_TO_UDINT(cycle_counter MOD UDINT_TO_DINT(structure_size));
			
			// Alternate between different data sizes
			CASE (cycle_counter MOD 3) OF
				0: // Write single bytes
					byte_ref ACCESS ADR(test) + offset;
					byte_ref := DINT_TO_USINT(cycle_counter MOD 256);
				1: // Write words (2 bytes), ensure alignment
					offset := offset AND 16#FFFFFFFE; // Align to word boundary
					IF offset + 2 <= structure_size THEN
						word_ref ACCESS ADR(test) + offset;
						word_ref := DINT_TO_UINT(cycle_counter MOD 65536);
					END_IF;
				2: // Write double words (4 bytes), ensure alignment
					offset := offset AND 16#FFFFFFFC; // Align to dword boundary
					IF offset + 4 <= structure_size THEN
						dword_ref ACCESS ADR(test) + offset;
						dword_ref := DINT_TO_UDINT(cycle_counter MOD 4294967295);
					END_IF;
			END_CASE;
			
		5, 6, 7, 8, 9: // Manipulate test_arrays structure (50% of the time)
			structure_size := SIZEOF(test_arrays);
			offset := DINT_TO_UDINT((cycle_counter * 7) MOD UDINT_TO_DINT(structure_size));
			
			// Alternate between different data sizes
			CASE ((cycle_counter * 3) MOD 3) OF
				0: // Write single bytes
					byte_ref ACCESS ADR(test_arrays) + offset;
					byte_ref := DINT_TO_USINT((cycle_counter * 11) MOD 256);
				1: // Write words (2 bytes), ensure alignment
					offset := offset AND 16#FFFFFFFE; // Align to word boundary
					IF offset + 2 <= structure_size THEN
						word_ref ACCESS ADR(test_arrays) + offset;
						word_ref := DINT_TO_UINT((cycle_counter * 13) MOD 65536);
					END_IF;
				2: // Write double words (4 bytes), ensure alignment
					offset := offset AND 16#FFFFFFFC; // Align to dword boundary
					IF offset + 4 <= structure_size THEN
						dword_ref ACCESS ADR(test_arrays) + offset;
						dword_ref := DINT_TO_UDINT((cycle_counter * 17) MOD 4294967295);
					END_IF;
			END_CASE;
	END_CASE;
		
	
	
END_PROGRAM

PROGRAM _EXIT
	(* Insert code here *)
	 
END_PROGRAM

